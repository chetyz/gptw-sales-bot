// ─── Pre-cached Report Generator for GPTW Sales Bot ─────────────────────────
// Generates 7 HTML dashboards at 4am Mexico City time (UTC-6)
// Each report queries Salesforce and produces a self-contained HTML dashboard

type QueryFn = (soql: string) => Promise<any>;

interface ReportCache {
  id: string;
  title: string;
  icon: string;
  html: string;
  generatedAt: string;
  summary: string;
}

// ─── Shared HTML helpers ─────────────────────────────────────────────────────

const COLORS = {
  red: '#FF1628',
  dark: '#11131C',
  white: '#FFFFFF',
  green: '#10B981',
  yellow: '#F59E0B',
  blue: '#3B82F6',
  gray: '#6B7280',
  lightGray: '#F3F4F6',
  border: '#E5E7EB',
};

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function fmt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '$0';
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K';
  return '$' + n.toFixed(0);
}

function fmtFull(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '$0';
  return '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 0 });
}

function pct(a: number, b: number): string {
  if (!b) return '0%';
  return ((a / b) * 100).toFixed(1) + '%';
}

function pctChange(current: number, previous: number): { text: string; color: string; arrow: string } {
  if (!previous) return { text: 'N/A', color: COLORS.gray, arrow: '' };
  const change = ((current - previous) / previous) * 100;
  const isUp = change >= 0;
  return {
    text: (isUp ? '+' : '') + change.toFixed(1) + '%',
    color: isUp ? COLORS.green : COLORS.red,
    arrow: isUp ? '&#9650;' : '&#9660;',
  };
}

function dashboardShell(title: string, date: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8f9fa;color:${COLORS.dark};padding:24px;min-height:100vh}
  .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid ${COLORS.red}}
  .header h1{font-size:20px;font-weight:700;color:${COLORS.dark}}
  .header .date{font-size:12px;color:${COLORS.gray}}
  .header .badge{background:${COLORS.red};color:#fff;font-size:10px;padding:3px 8px;border-radius:10px;font-weight:600}
  .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
  .kpi{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
  .kpi .label{font-size:11px;color:${COLORS.gray};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
  .kpi .value{font-size:26px;font-weight:700;color:${COLORS.dark}}
  .kpi .sub{font-size:12px;margin-top:4px;display:flex;align-items:center;gap:4px}
  .chart-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:16px;margin-bottom:24px}
  .chart-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
  .chart-card h3{font-size:14px;font-weight:600;margin-bottom:16px;color:${COLORS.dark}}
  .chart-wrap{position:relative;height:250px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:10px 12px;background:${COLORS.lightGray};font-weight:600;color:${COLORS.dark};border-bottom:1px solid ${COLORS.border}}
  td{padding:10px 12px;border-bottom:1px solid ${COLORS.border}}
  tr:hover td{background:#f9fafb}
  .table-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:24px;overflow-x:auto}
  .table-card h3{font-size:14px;font-weight:600;margin-bottom:16px;color:${COLORS.dark}}
  .tag{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600}
  .tag-green{background:#D1FAE5;color:#065F46}
  .tag-red{background:#FEE2E2;color:#991B1B}
  .tag-yellow{background:#FEF3C7;color:#92400E}
  .tag-blue{background:#DBEAFE;color:#1E40AF}
  .footer{text-align:center;font-size:11px;color:${COLORS.gray};margin-top:24px;padding-top:16px;border-top:1px solid ${COLORS.border}}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>${title}</h1>
    <span class="date">Generado: ${date} | Fuente: Salesforce - GPTW Mexico</span>
  </div>
  <span class="badge">Auto-generado 4am</span>
</div>
${body}
<div class="footer">Great Place to Work Mexico - Dashboard generado automaticamente</div>
</body>
</html>`;
}

// ─── Report 1: Ejecutivo ─────────────────────────────────────────────────────

async function generateEjecutivo(query: QueryFn): Promise<ReportCache> {
  const now = new Date();
  const year = now.getFullYear();
  const lastYear = year - 1;

  const [ventasYTD, ventasLY, ticketProm, cuentasTipo, ventasMesActual, ventasMesAnterior] = await Promise.all([
    query(`SELECT SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN'`),
    query(`SELECT SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = LAST_YEAR AND CurrencyIsoCode = 'MXN'`),
    query(`SELECT AVG(Amount) avg FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN'`),
    query(`SELECT Tipo_de_Cuenta__c tipo, COUNT(Id) cnt FROM Account WHERE Tipo_de_Cuenta__c != null GROUP BY Tipo_de_Cuenta__c ORDER BY COUNT(Id) DESC`),
    query(`SELECT CALENDAR_MONTH(CloseDate) mes, SUM(Amount) total FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY CALENDAR_MONTH(CloseDate) ORDER BY CALENDAR_MONTH(CloseDate)`),
    query(`SELECT CALENDAR_MONTH(CloseDate) mes, SUM(Amount) total FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = LAST_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY CALENDAR_MONTH(CloseDate) ORDER BY CALENDAR_MONTH(CloseDate)`),
  ]);

  const totalYTD = ventasYTD.records?.[0]?.total || 0;
  const totalLY = ventasLY.records?.[0]?.total || 0;
  const cntYTD = ventasYTD.records?.[0]?.cnt || 0;
  const ticket = ticketProm.records?.[0]?.avg || 0;
  const yoyChange = pctChange(totalYTD, totalLY);

  // Build monthly data arrays
  const monthDataCurrent = new Array(12).fill(0);
  const monthDataLast = new Array(12).fill(0);
  let accumCurrent = 0, accumLast = 0;
  const accumCurrentArr: number[] = [];
  const accumLastArr: number[] = [];

  function getMonthNum(rec: any): number | null {
    for (const k of Object.keys(rec)) {
      if (k === 'attributes' || k === 'total' || k === 'cnt') continue;
      const v = Number(rec[k]); if (!isNaN(v) && v >= 1 && v <= 12) return v;
    }
    return null;
  }
  (ventasMesActual.records || []).forEach((r: any) => { const m = getMonthNum(r); if (m) monthDataCurrent[m - 1] = r.total || 0; });
  (ventasMesAnterior.records || []).forEach((r: any) => { const m = getMonthNum(r); if (m) monthDataLast[m - 1] = r.total || 0; });

  for (let i = 0; i < 12; i++) {
    accumCurrent += monthDataCurrent[i];
    accumLast += monthDataLast[i];
    accumCurrentArr.push(accumCurrent);
    accumLastArr.push(accumLast);
  }

  // Cuentas breakdown
  const cuentasData = (cuentasTipo.records || []).map((r: any) => ({ tipo: r.tipo, cnt: r.cnt }));
  const cuentasActivas = cuentasData.find((c: any) => c.tipo?.includes('Activo'))?.cnt || 0;
  const cuentasPerdidas = cuentasData.find((c: any) => c.tipo?.includes('Perdido'))?.cnt || 0;
  const cuentasNuevas = cuentasData.find((c: any) => c.tipo?.includes('Nuevo'))?.cnt || 0;

  const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const currentMonth = now.getMonth(); // 0-indexed

  const body = `
<!-- FILTERS BAR -->
<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:20px;padding:16px 20px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
  <div style="font-size:13px;font-weight:600;color:#11131C;margin-right:8px">Filtros:</div>
  <div style="display:flex;align-items:center;gap:6px">
    <label style="font-size:12px;color:#6b7280">Desde</label>
    <select id="fDesde" onchange="applyFilters()" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;cursor:pointer">
      ${MONTHS.map((m, i) => `<option value="${i}" ${i === 0 ? 'selected' : ''}>${m}</option>`).join('')}
    </select>
  </div>
  <div style="display:flex;align-items:center;gap:6px">
    <label style="font-size:12px;color:#6b7280">Hasta</label>
    <select id="fHasta" onchange="applyFilters()" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;background:#fff;cursor:pointer">
      ${MONTHS.map((m, i) => `<option value="${i}" ${i === currentMonth ? 'selected' : ''}>${m}</option>`).join('')}
    </select>
  </div>
  <div style="display:flex;align-items:center;gap:6px;margin-left:8px">
    <input type="checkbox" id="fShowLY" checked onchange="applyFilters()" style="cursor:pointer">
    <label for="fShowLY" style="font-size:12px;color:#6b7280;cursor:pointer">Comparar con ${lastYear}</label>
  </div>
  <div style="display:flex;gap:6px;margin-left:auto">
    <button onclick="setPreset('ytd')" style="padding:5px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:11px;background:#fff;cursor:pointer;font-weight:500">YTD</button>
    <button onclick="setPreset('q1')" style="padding:5px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:11px;background:#fff;cursor:pointer;font-weight:500">Q1</button>
    <button onclick="setPreset('q2')" style="padding:5px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:11px;background:#fff;cursor:pointer;font-weight:500">Q2</button>
    <button onclick="setPreset('q3')" style="padding:5px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:11px;background:#fff;cursor:pointer;font-weight:500">Q3</button>
    <button onclick="setPreset('q4')" style="padding:5px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:11px;background:#fff;cursor:pointer;font-weight:500">Q4</button>
    <button onclick="setPreset('all')" style="padding:5px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:11px;background:#fff;cursor:pointer;font-weight:500">Todo ${year}</button>
  </div>
</div>

<!-- KPIs (dynamic) -->
<div class="kpi-row" id="kpiRow"></div>

<!-- Charts -->
<div class="chart-row">
  <div class="chart-card" style="grid-column:1/-1">
    <h3 id="accumTitle">Venta Acumulada ${year}</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="accumChart"></canvas></div>
  </div>
</div>

<div class="chart-row">
  <div class="chart-card">
    <h3 id="monthTitle">Venta Mensual ${year}</h3>
    <div class="chart-wrap"><canvas id="monthChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Distribucion de Cuentas</h3>
    <div class="chart-wrap"><canvas id="cuentasChart"></canvas></div>
  </div>
</div>

<script>
// ── Raw data (all 12 months) ──
const MESES = ${JSON.stringify(MONTHS)};
const DATA_CURRENT = ${JSON.stringify(monthDataCurrent)};
const DATA_LAST = ${JSON.stringify(monthDataLast)};
const YEAR = ${year};
const LAST_YEAR = ${lastYear};
const CUENTAS_LABELS = ${JSON.stringify(cuentasData.map((c: any) => c.tipo))};
const CUENTAS_DATA = ${JSON.stringify(cuentasData.map((c: any) => c.cnt))};
const fontDef = {family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11};

function fmt(n){if(Math.abs(n)>=1e6)return'$'+(n/1e6).toFixed(1)+'M';if(Math.abs(n)>=1e3)return'$'+(n/1e3).toFixed(0)+'K';return'$'+n.toFixed(0)}
function fmtFull(n){return'$'+n.toLocaleString('es-MX',{maximumFractionDigits:0})}

let accumChart, monthChart, cuentasChart;

function initCharts(){
  accumChart = new Chart(document.getElementById('accumChart'),{type:'line',data:{labels:[],datasets:[]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}},tooltip:{callbacks:{label:c=>'$'+(c.parsed.y/1e6).toFixed(2)+'M MXN'}}},scales:{y:{ticks:{callback:v=>'$'+(v/1e6).toFixed(0)+'M',font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef},grid:{display:false}}}}});
  monthChart = new Chart(document.getElementById('monthChart'),{type:'bar',data:{labels:[],datasets:[]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}}},scales:{y:{ticks:{callback:v=>'$'+(v/1e6).toFixed(1)+'M',font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef},grid:{display:false}}}}});
  cuentasChart = new Chart(document.getElementById('cuentasChart'),{type:'doughnut',data:{labels:CUENTAS_LABELS,datasets:[{data:CUENTAS_DATA,backgroundColor:['${COLORS.green}','${COLORS.red}','${COLORS.blue}','${COLORS.yellow}','${COLORS.gray}']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:fontDef,boxWidth:10}}}}});
  applyFilters();
}

function setPreset(p){
  const d=document.getElementById('fDesde'), h=document.getElementById('fHasta');
  if(p==='ytd'){d.value=0;h.value=${currentMonth};}
  else if(p==='q1'){d.value=0;h.value=2;}
  else if(p==='q2'){d.value=3;h.value=5;}
  else if(p==='q3'){d.value=6;h.value=8;}
  else if(p==='q4'){d.value=9;h.value=11;}
  else if(p==='all'){d.value=0;h.value=11;}
  applyFilters();
}

function applyFilters(){
  const desde = parseInt(document.getElementById('fDesde').value);
  const hasta = parseInt(document.getElementById('fHasta').value);
  const showLY = document.getElementById('fShowLY').checked;
  const start = Math.min(desde,hasta);
  const end = Math.max(desde,hasta);

  // Filter months
  const labels = MESES.slice(start, end+1);
  const dataCur = DATA_CURRENT.slice(start, end+1);
  const dataLast = DATA_LAST.slice(start, end+1);

  // Accumulate
  let accCur=0, accLast=0;
  const accumCur=dataCur.map(v=>(accCur+=v,accCur));
  const accumLast=dataLast.map(v=>(accLast+=v,accLast));

  // KPIs
  const totalCur = dataCur.reduce((s,v)=>s+v,0);
  const totalLast = dataLast.reduce((s,v)=>s+v,0);
  const countMonths = end-start+1;
  const ticketAvg = totalCur/(countMonths||1);
  const pctChg = totalLast>0?((totalCur-totalLast)/totalLast*100):0;
  const chgColor = pctChg>=0?'${COLORS.green}':'${COLORS.red}';
  const chgArrow = pctChg>=0?'&#9650;':'&#9660;';

  document.getElementById('kpiRow').innerHTML = \`
    <div class="kpi"><div class="label">Venta \${MESES[start]} - \${MESES[end]} \${YEAR}</div><div class="value">\${fmtFull(totalCur)}</div>\${showLY?\`<div class="sub" style="color:\${chgColor}">\${chgArrow} \${pctChg>=0?'+':''}\${pctChg.toFixed(1)}% vs \${LAST_YEAR}</div>\`:''}</div>
    \${showLY?\`<div class="kpi"><div class="label">Mismo periodo \${LAST_YEAR}</div><div class="value">\${fmtFull(totalLast)}</div></div>\`:''}
    <div class="kpi"><div class="label">Promedio Mensual</div><div class="value">\${fmtFull(ticketAvg)}</div><div class="sub">\${countMonths} meses</div></div>
    <div class="kpi"><div class="label">Cuentas Activas</div><div class="value">${cuentasActivas.toLocaleString()}</div><div class="sub"><span class="tag tag-green">Activas</span></div></div>
    <div class="kpi"><div class="label">Cuentas Perdidas</div><div class="value">${cuentasPerdidas.toLocaleString()}</div><div class="sub"><span class="tag tag-red">Churn</span></div></div>
  \`;

  // Update accum chart
  document.getElementById('accumTitle').textContent = 'Venta Acumulada '+MESES[start]+' - '+MESES[end]+' '+YEAR;
  accumChart.data.labels = labels;
  accumChart.data.datasets = [{label:YEAR+'',data:accumCur,borderColor:'${COLORS.red}',backgroundColor:'rgba(255,22,40,0.08)',fill:true,tension:0.4,borderWidth:2.5,pointRadius:3}];
  if(showLY) accumChart.data.datasets.push({label:LAST_YEAR+'',data:accumLast,borderColor:'${COLORS.blue}',backgroundColor:'rgba(59,130,246,0.05)',fill:true,tension:0.4,borderWidth:2,borderDash:[5,5],pointRadius:2});
  accumChart.update();

  // Update month chart
  document.getElementById('monthTitle').textContent = 'Venta Mensual '+YEAR;
  monthChart.data.labels = labels;
  monthChart.data.datasets = [{label:YEAR+'',data:dataCur,backgroundColor:'rgba(255,22,40,0.7)',borderRadius:4}];
  if(showLY) monthChart.data.datasets.push({label:LAST_YEAR+'',data:dataLast,backgroundColor:'rgba(59,130,246,0.4)',borderRadius:4});
  monthChart.update();
}

initCharts();
</script>`;

  return {
    id: 'ejecutivo',
    title: 'Dashboard Ejecutivo',
    icon: '&#128200;',
    html: dashboardShell(`Dashboard Ejecutivo - ${year}`, date, body),
    generatedAt: now.toISOString(),
    summary: `Venta YTD: ${fmt(totalYTD)} (${yoyChange.text} vs ${lastYear}) | Ticket: ${fmt(ticket)} | Cuentas activas: ${cuentasActivas}`,
  };
}

// ─── Report 2: Ventas y Renovaciones ─────────────────────────────────────────

async function generateVentas(query: QueryFn): Promise<ReportCache> {
  const now = new Date();
  const year = now.getFullYear();

  const [porTipo, porMesTipo, motivosPerdida] = await Promise.all([
    query(`SELECT Estatus_anual__c tipo, COUNT(Id) cnt, SUM(Amount) total FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY Estatus_anual__c ORDER BY SUM(Amount) DESC`),
    query(`SELECT CALENDAR_MONTH(CloseDate) mes, Estatus_anual__c tipo, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY CALENDAR_MONTH(CloseDate), Estatus_anual__c ORDER BY CALENDAR_MONTH(CloseDate)`),
    query(`SELECT Razon_de__c motivo, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Perdida' AND CloseDate = THIS_YEAR AND Razon_de__c != null GROUP BY Razon_de__c ORDER BY COUNT(Id) DESC LIMIT 8`),
  ]);

  const tipoData = (porTipo.records || []).map((r: any) => ({ tipo: r.tipo || 'Sin dato', cnt: r.cnt, total: r.total || 0 }));
  const totalVentas = tipoData.reduce((s: number, t: any) => s + t.total, 0);

  // Monthly breakdown by tipo
  const monthNuevo = new Array(12).fill(0);
  const monthRenov = new Array(12).fill(0);
  const monthAdic = new Array(12).fill(0);
  (porMesTipo.records || []).forEach((r: any) => {
    let monthVal = null;
    for (const k of Object.keys(r)) {
      if (k === 'attributes' || k === 'total' || k === 'cnt' || k === 'tipo') continue;
      const v = Number(r[k]); if (!isNaN(v) && v >= 1 && v <= 12) { monthVal = v; break; }
    }
    const idx = (monthVal || 1) - 1;
    if (r.tipo === 'Nuevo') monthNuevo[idx] = r.total || 0;
    else if (r.tipo === 'Renovación') monthRenov[idx] = r.total || 0;
    else monthAdic[idx] = r.total || 0;
  });

  // Tasa renovacion por mes
  const tasaRenov = monthRenov.map((r, i) => {
    const total = r + monthNuevo[i] + monthAdic[i];
    return total > 0 ? Math.round((r / total) * 100) : 0;
  });

  const motivosData = (motivosPerdida.records || []).map((r: any) => ({ motivo: r.motivo, cnt: r.cnt }));

  const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const body = `
<div class="kpi-row">
  ${tipoData.map((t: any) => `
  <div class="kpi">
    <div class="label">${t.tipo}</div>
    <div class="value">${fmtFull(t.total)}</div>
    <div class="sub">${t.cnt} opps | ${pct(t.total, totalVentas)} del total</div>
  </div>`).join('')}
</div>

<div class="chart-row">
  <div class="chart-card">
    <h3>Ventas Mensuales por Tipo</h3>
    <div class="chart-wrap"><canvas id="ventasTipoChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Tasa de Renovacion Mensual (%)</h3>
    <div class="chart-wrap"><canvas id="tasaChart"></canvas></div>
  </div>
</div>

<div class="chart-row">
  <div class="chart-card">
    <h3>Motivos de Perdida (${year})</h3>
    <div class="chart-wrap"><canvas id="motivosChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Composicion por Tipo de Venta</h3>
    <div class="chart-wrap"><canvas id="pieChart"></canvas></div>
  </div>
</div>

<script>
const meses=${JSON.stringify(MONTHS)};
const fontDef={family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11};

new Chart(document.getElementById('ventasTipoChart'),{
  type:'bar',
  data:{labels:meses,datasets:[
    {label:'Nuevo',data:${JSON.stringify(monthNuevo)},backgroundColor:'${COLORS.blue}',borderRadius:3},
    {label:'Renovación',data:${JSON.stringify(monthRenov)},backgroundColor:'${COLORS.green}',borderRadius:3},
    {label:'Adicional',data:${JSON.stringify(monthAdic)},backgroundColor:'${COLORS.yellow}',borderRadius:3}
  ]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}}},scales:{y:{stacked:true,ticks:{callback:v=>'$'+(v/1000000).toFixed(1)+'M',font:fontDef}},x:{stacked:true,ticks:{font:fontDef}}}}
});

new Chart(document.getElementById('tasaChart'),{
  type:'line',
  data:{labels:meses,datasets:[{label:'% Renovacion',data:${JSON.stringify(tasaRenov)},borderColor:'${COLORS.green}',backgroundColor:'rgba(16,185,129,0.1)',fill:true,tension:0.4,borderWidth:2.5,pointRadius:4,pointBackgroundColor:'${COLORS.green}'}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%',font:fontDef}},x:{ticks:{font:fontDef}}}}
});

new Chart(document.getElementById('motivosChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(motivosData.map((m: any) => m.motivo))},datasets:[{data:${JSON.stringify(motivosData.map((m: any) => m.cnt))},backgroundColor:'${COLORS.red}',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{font:fontDef}},y:{ticks:{font:{...fontDef,size:10}}}}}
});

new Chart(document.getElementById('pieChart'),{
  type:'doughnut',
  data:{labels:${JSON.stringify(tipoData.map((t: any) => t.tipo))},datasets:[{data:${JSON.stringify(tipoData.map((t: any) => t.total))},backgroundColor:['${COLORS.blue}','${COLORS.green}','${COLORS.yellow}','${COLORS.gray}']}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:fontDef,boxWidth:10}}}}
});
</script>`;

  return {
    id: 'ventas',
    title: 'Ventas y Renovaciones',
    icon: '&#128176;',
    html: dashboardShell(`Ventas y Renovaciones - ${year}`, date, body),
    generatedAt: now.toISOString(),
    summary: `Total: ${fmt(totalVentas)} | Nuevo: ${fmt(tipoData.find((t: any) => t.tipo === 'Nuevo')?.total || 0)} | Renovacion: ${fmt(tipoData.find((t: any) => t.tipo === 'Renovación')?.total || 0)}`,
  };
}

// ─── Report 3: Pipeline ──────────────────────────────────────────────────────

async function generatePipeline(query: QueryFn): Promise<ReportCache> {
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 86400000);
  const nextWeekStr = nextWeek.toISOString().split('T')[0];

  const [porEtapa, semaforo, porCerrarSemana, topOpps] = await Promise.all([
    query(`SELECT StageName, COUNT(Id) cnt, SUM(Amount) total FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') GROUP BY StageName ORDER BY SUM(Amount) DESC`),
    query(`SELECT Sem_foro_de_gesti_n__c semaforo, COUNT(Id) cnt, SUM(Amount) total FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND Sem_foro_de_gesti_n__c != null GROUP BY Sem_foro_de_gesti_n__c`),
    query(`SELECT Name, Account.Name acct, Amount, StageName, CloseDate, Owner.Name owner FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CloseDate <= ${nextWeekStr} ORDER BY Amount DESC NULLS LAST LIMIT 15`),
    query(`SELECT Name, Account.Name acct, Amount, StageName, Owner.Name owner FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') ORDER BY Amount DESC NULLS LAST LIMIT 10`),
  ]);

  const etapas = (porEtapa.records || []).map((r: any) => ({ etapa: r.StageName, cnt: r.cnt, total: r.total || 0 }));
  const totalPipeline = etapas.reduce((s: number, e: any) => s + e.total, 0);
  const totalOpps = etapas.reduce((s: number, e: any) => s + e.cnt, 0);

  const semaforoData = (semaforo.records || []).map((r: any) => ({ semaforo: r.semaforo, cnt: r.cnt, total: r.total || 0 }));
  const semaforoColors: Record<string, string> = { Verde: COLORS.green, Amarillo: COLORS.yellow, Rojo: COLORS.red, Azul: COLORS.blue };

  const cierreProx = (porCerrarSemana.records || []).map((r: any) => ({
    name: r.Name, acct: r.acct, amount: r.Amount || 0, stage: r.StageName, close: r.CloseDate, owner: r.owner
  }));

  const topData = (topOpps.records || []).map((r: any) => ({
    name: r.Name, acct: r.acct, amount: r.Amount || 0, stage: r.StageName, owner: r.owner
  }));

  const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const body = `
<div class="kpi-row">
  <div class="kpi">
    <div class="label">Pipeline Total</div>
    <div class="value">${fmtFull(totalPipeline)}</div>
    <div class="sub">${totalOpps} oportunidades abiertas</div>
  </div>
  <div class="kpi">
    <div class="label">Por Cerrar esta Semana</div>
    <div class="value">${cierreProx.length}</div>
    <div class="sub">${fmtFull(cierreProx.reduce((s: number, c: any) => s + c.amount, 0))} en juego</div>
  </div>
  ${semaforoData.map((s: any) => `
  <div class="kpi">
    <div class="label">Semaforo ${s.semaforo}</div>
    <div class="value" style="color:${semaforoColors[s.semaforo] || COLORS.gray}">${s.cnt}</div>
    <div class="sub">${fmt(s.total)}</div>
  </div>`).join('')}
</div>

<div class="chart-row">
  <div class="chart-card">
    <h3>Pipeline por Etapa</h3>
    <div class="chart-wrap"><canvas id="etapaChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Semaforo de Gestion</h3>
    <div class="chart-wrap"><canvas id="semaforoChart"></canvas></div>
  </div>
</div>

<div class="table-card">
  <h3>Oportunidades por Cerrar esta Semana</h3>
  <table>
    <tr><th>Oportunidad</th><th>Cuenta</th><th>Monto</th><th>Etapa</th><th>Ejecutivo</th><th>Cierre</th></tr>
    ${cierreProx.map((c: any) => `<tr><td>${c.name}</td><td>${c.acct || '-'}</td><td>${fmtFull(c.amount)}</td><td>${c.stage}</td><td>${c.owner || '-'}</td><td>${c.close || '-'}</td></tr>`).join('')}
    ${cierreProx.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#999">Sin oportunidades por cerrar esta semana</td></tr>' : ''}
  </table>
</div>

<div class="table-card">
  <h3>Top 10 Oportunidades Abiertas por Monto</h3>
  <table>
    <tr><th>Oportunidad</th><th>Cuenta</th><th>Monto</th><th>Etapa</th><th>Ejecutivo</th></tr>
    ${topData.map((t: any) => `<tr><td>${t.name}</td><td>${t.acct || '-'}</td><td>${fmtFull(t.amount)}</td><td>${t.stage}</td><td>${t.owner || '-'}</td></tr>`).join('')}
  </table>
</div>

<script>
const fontDef={family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11};

new Chart(document.getElementById('etapaChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(etapas.map((e: any) => e.etapa))},datasets:[{data:${JSON.stringify(etapas.map((e: any) => e.total))},backgroundColor:'rgba(255,22,40,0.7)',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'$'+(c.parsed.x/1000000).toFixed(2)+'M | '+${JSON.stringify(etapas.map((e: any) => e.cnt))}[c.dataIndex]+' opps'}}},scales:{x:{ticks:{callback:v=>'$'+(v/1000000).toFixed(1)+'M',font:fontDef}},y:{ticks:{font:fontDef}}}}
});

new Chart(document.getElementById('semaforoChart'),{
  type:'doughnut',
  data:{labels:${JSON.stringify(semaforoData.map((s: any) => s.semaforo))},datasets:[{data:${JSON.stringify(semaforoData.map((s: any) => s.cnt))},backgroundColor:${JSON.stringify(semaforoData.map((s: any) => semaforoColors[s.semaforo] || COLORS.gray))}}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:fontDef,boxWidth:10}}}}
});
</script>`;

  return {
    id: 'pipeline',
    title: 'Pipeline y Oportunidades',
    icon: '&#128640;',
    html: dashboardShell('Pipeline y Oportunidades', date, body),
    generatedAt: now.toISOString(),
    summary: `Pipeline: ${fmt(totalPipeline)} (${totalOpps} opps) | ${cierreProx.length} por cerrar esta semana`,
  };
}

// ─── Report 4: Control Comercial ─────────────────────────────────────────────
// Includes: activity breakdown, client-facing meetings correlation with sales,
// efficiency metrics, and sales forecast based on commercial activity patterns.

const CLIENT_MEETING_TYPES = [
  'Reunión Primera visita comercial',
  'Reunión Presentación de propuesta',
  'Reunión de negociación',
  'Reunión de indagación de necesidades',
  'Entrega de Resultados',
];

async function generateComercial(query: QueryFn): Promise<ReportCache> {
  const now = new Date();
  const year = now.getFullYear();

  const [
    eventsByType,
    eventsByOwner,
    salesByOwner,
    ratioEjec,
    actPorTipo,
    eventsByMonth,
    salesByMonth,
    tasksByOwner,
  ] = await Promise.all([
    // Event types breakdown (YTD)
    query(`SELECT Type, COUNT(Id) cnt FROM Event WHERE CreatedDate = THIS_YEAR AND Type != null GROUP BY Type ORDER BY COUNT(Id) DESC`),
    // Client-facing meetings per owner (YTD)
    query(`SELECT OwnerId, COUNT(Id) cnt FROM Event WHERE CreatedDate = THIS_YEAR AND Type IN ('Reunión Primera visita comercial','Reunión Presentación de propuesta','Reunión de negociación','Reunión de indagación de necesidades','Entrega de Resultados') GROUP BY OwnerId ORDER BY COUNT(Id) DESC LIMIT 15`),
    // Sales per owner (YTD)
    query(`SELECT OwnerId, COUNT(Id) cnt, SUM(Amount) total FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY OwnerId ORDER BY SUM(Amount) DESC LIMIT 15`),
    // Win rate per owner (YTD)
    query(`SELECT OwnerId, StageName, COUNT(Id) cnt FROM Opportunity WHERE CloseDate = THIS_YEAR AND StageName IN ('Ganada!','Perdida') GROUP BY OwnerId, StageName ORDER BY OwnerId`),
    // Task subtypes this month
    query(`SELECT TaskSubtype tipo, COUNT(Id) cnt FROM Task WHERE CreatedDate = THIS_MONTH AND TaskSubtype != null GROUP BY TaskSubtype ORDER BY COUNT(Id) DESC LIMIT 10`),
    // Client meetings by month (YTD) for trend
    query(`SELECT CALENDAR_MONTH(CreatedDate) mes, COUNT(Id) cnt FROM Event WHERE CreatedDate = THIS_YEAR AND Type IN ('Reunión Primera visita comercial','Reunión Presentación de propuesta','Reunión de negociación','Reunión de indagación de necesidades') GROUP BY CALENDAR_MONTH(CreatedDate) ORDER BY CALENDAR_MONTH(CreatedDate)`),
    // Sales by month (YTD) for correlation
    query(`SELECT CALENDAR_MONTH(CloseDate) mes, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY CALENDAR_MONTH(CloseDate) ORDER BY CALENDAR_MONTH(CloseDate)`),
    // Activities per owner this month (Tasks) - MUST BE LAST to match destructuring
    query(`SELECT OwnerId, COUNT(Id) cnt FROM Task WHERE CreatedDate = THIS_MONTH GROUP BY OwnerId ORDER BY COUNT(Id) DESC LIMIT 15`),
  ]);

  // Get user names for the owner IDs we found
  const ownerIds = new Set<string>();
  (eventsByOwner.records || []).forEach((r: any) => ownerIds.add(r.OwnerId));
  (salesByOwner.records || []).forEach((r: any) => ownerIds.add(r.OwnerId));
  (tasksByOwner.records || []).forEach((r: any) => ownerIds.add(r.OwnerId));
  // Fetch ALL active user names (simple query that always works)
  const userNames = new Map<string, string>();
  try {
    const allUsers = await query(`SELECT Id, Name FROM User WHERE IsActive = true LIMIT 100`);
    (allUsers.records || []).forEach((u: any) => userNames.set(u.Id, u.Name));
  } catch (e: any) {
    process.stderr.write(`[reports] User query failed: ${e.message}\n`);
  }

  // --- Event types: separate client-facing vs internal ---
  const allEventTypes = (eventsByType.records || []).map((r: any) => ({ type: r.Type, cnt: r.cnt }));
  const clientEvents = allEventTypes.filter(e => CLIENT_MEETING_TYPES.includes(e.type));
  const internalEvents = allEventTypes.filter(e => !CLIENT_MEETING_TYPES.includes(e.type));
  const totalClientMeetings = clientEvents.reduce((s, e) => s + e.cnt, 0);
  const totalInternalEvents = internalEvents.reduce((s, e) => s + e.cnt, 0);

  // --- Correlation: meetings per owner vs sales ---
  const meetingsMap = new Map<string, number>();
  (eventsByOwner.records || []).forEach((r: any) => meetingsMap.set(r.OwnerId, r.cnt));

  const salesMap = new Map<string, { cnt: number; total: number }>();
  (salesByOwner.records || []).forEach((r: any) => salesMap.set(r.OwnerId, { cnt: r.cnt, total: r.total || 0 }));

  // Win rate map
  const winRateMap = new Map<string, { ganadas: number; perdidas: number }>();
  (ratioEjec.records || []).forEach((r: any) => {
    if (!winRateMap.has(r.OwnerId)) winRateMap.set(r.OwnerId, { ganadas: 0, perdidas: 0 });
    const entry = winRateMap.get(r.OwnerId)!;
    if (r.StageName === 'Ganada!') entry.ganadas = r.cnt;
    else entry.perdidas = r.cnt;
  });

  // Build correlation dataset
  const correlationData = Array.from(new Set([...meetingsMap.keys(), ...salesMap.keys()]))
    .map(ownerId => {
      const name = userNames.get(ownerId) || ownerId;
      const meetings = meetingsMap.get(ownerId) || 0;
      const sales = salesMap.get(ownerId) || { cnt: 0, total: 0 };
      const wr = winRateMap.get(ownerId) || { ganadas: 0, perdidas: 0 };
      const winRate = wr.ganadas + wr.perdidas > 0 ? Math.round((wr.ganadas / (wr.ganadas + wr.perdidas)) * 100) : 0;
      const efficiency = meetings > 0 ? Math.round(sales.total / meetings) : 0; // $ per meeting
      const ratio = sales.cnt > 0 ? +(meetings / sales.cnt).toFixed(1) : 0; // meetings per deal
      return { name: name.split(' ').slice(0, 2).join(' '), fullName: name, meetings, deals: sales.cnt, revenue: sales.total, winRate, efficiency, ratio };
    })
    .filter(d => d.meetings > 0 || d.deals > 0)
    .sort((a, b) => b.revenue - a.revenue);

  // --- Monthly trend for correlation chart ---
  // Helper: SF REST API returns CALENDAR_MONTH as expr0 (number or string)
  function getMonthVal(rec: any): number | null {
    for (const k of Object.keys(rec)) {
      if (k === 'attributes' || k === 'cnt' || k === 'total') continue;
      const v = Number(rec[k]);
      if (!isNaN(v) && v >= 1 && v <= 12) return v;
    }
    return null;
  }

  const monthlyMeetings = new Array(12).fill(0);
  const monthlySales = new Array(12).fill(0);
  const monthlySalesCount = new Array(12).fill(0);
  // Debug: log first record to see actual SF response structure
  if (eventsByMonth.records?.[0]) {
    process.stderr.write(`[reports-debug] eventsByMonth record keys: ${JSON.stringify(Object.keys(eventsByMonth.records[0]))}\n`);
    process.stderr.write(`[reports-debug] eventsByMonth record[0]: ${JSON.stringify(eventsByMonth.records[0])}\n`);
  }
  (eventsByMonth.records || []).forEach((r: any) => {
    const m = getMonthVal(r);
    if (m) monthlyMeetings[m - 1] = r.cnt;
  });
  (salesByMonth.records || []).forEach((r: any) => {
    const m = getMonthVal(r);
    if (m) { monthlySales[m - 1] = r.total || 0; monthlySalesCount[m - 1] = r.cnt; }
  });

  // --- Forecast: based on avg $ per meeting, project remaining year ---
  const totalMeetingsYTD = correlationData.reduce((s, d) => s + d.meetings, 0);
  const totalRevenueYTD = correlationData.reduce((s, d) => s + d.revenue, 0);
  const avgRevenuePerMeeting = totalMeetingsYTD > 0 ? totalRevenueYTD / totalMeetingsYTD : 0;
  const monthsElapsed = now.getMonth() + 1;
  const avgMeetingsPerMonth = totalMeetingsYTD / Math.max(monthsElapsed, 1);
  const projectedMeetingsYear = Math.round(avgMeetingsPerMonth * 12);
  const projectedRevenueYear = avgRevenuePerMeeting * projectedMeetingsYear;
  const forecastRemaining = projectedRevenueYear - totalRevenueYTD;

  // Scatter data for correlation chart (meetings vs revenue)
  const scatterData = correlationData.map(d => ({ x: d.meetings, y: d.revenue, name: d.name }));

  // Task activity types
  const actTipo = (actPorTipo.records || []).map((r: any) => ({ tipo: r.tipo, cnt: r.cnt }));

  // Tasks by owner this month
  const actEjec = (tasksByOwner.records || []).map((r: any) => ({
    name: (userNames.get(r.OwnerId) || 'Sin asignar').split(' ').slice(0, 2).join(' '),
    cnt: r.cnt
  }));
  const totalAct = actEjec.reduce((s: number, a: any) => s + a.cnt, 0);

  // Win rate table data with visual bars
  const winRateTable = correlationData
    .filter(d => d.winRate > 0 || d.deals > 0)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 12);

  const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const body = `
<div class="kpi-row">
  <div class="kpi">
    <div class="label">Reuniones Comerciales YTD</div>
    <div class="value">${totalClientMeetings.toLocaleString()}</div>
    <div class="sub" style="color:${COLORS.green}">De cara al cliente</div>
  </div>
  <div class="kpi">
    <div class="label">$ por Reunion Promedio</div>
    <div class="value">${fmtFull(avgRevenuePerMeeting)}</div>
    <div class="sub">Eficiencia comercial</div>
  </div>
  <div class="kpi">
    <div class="label">Pronostico Anual</div>
    <div class="value">${fmt(projectedRevenueYear)}</div>
    <div class="sub">Basado en ritmo actual de reuniones</div>
  </div>
  <div class="kpi">
    <div class="label">Faltan por Cerrar</div>
    <div class="value" style="color:${COLORS.blue}">${fmt(forecastRemaining)}</div>
    <div class="sub">Proyeccion restante ${year}</div>
  </div>
  <div class="kpi">
    <div class="label">Actividades este Mes</div>
    <div class="value">${totalAct.toLocaleString()}</div>
    <div class="sub">Tareas + Emails + Llamadas</div>
  </div>
  <div class="kpi">
    <div class="label">Ejecutivos Activos</div>
    <div class="value">${actEjec.length}</div>
  </div>
</div>

<div class="chart-row">
  <div class="chart-card" style="grid-column:1/-1">
    <h3>Correlacion: Reuniones Comerciales vs Revenue por Ejecutivo</h3>
    <p style="font-size:11px;color:#6b7280;margin-bottom:12px">Cada burbuja es un ejecutivo. Tamano = revenue. Los ejecutivos arriba-izquierda son los mas eficientes (mas revenue con menos reuniones).</p>
    <div class="chart-wrap" style="height:320px"><canvas id="scatterChart"></canvas></div>
  </div>
</div>

<div class="chart-row">
  <div class="chart-card">
    <h3>Tendencia: Reuniones vs Ventas por Mes</h3>
    <div class="chart-wrap"><canvas id="trendChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Tipos de Reunion (YTD)</h3>
    <div class="chart-wrap"><canvas id="eventTypeChart"></canvas></div>
  </div>
</div>

<div class="table-card">
  <h3>Eficiencia Comercial por Ejecutivo (${year})</h3>
  <p style="font-size:11px;color:#6b7280;margin-bottom:12px">Ordenado por revenue. "Reuniones/Deal" indica cuantas reuniones necesita para cerrar 1 venta. Menor = mas eficiente.</p>
  <table>
    <tr><th>Ejecutivo</th><th>Reuniones</th><th>Deals</th><th>Revenue</th><th>$/Reunion</th><th>Reuniones/Deal</th><th>Win Rate</th><th>Eficiencia</th></tr>
    ${correlationData.slice(0, 12).map((d: any) => {
      const effColor = d.efficiency >= avgRevenuePerMeeting ? COLORS.green : d.efficiency > avgRevenuePerMeeting * 0.5 ? COLORS.yellow : COLORS.red;
      const effLabel = d.efficiency >= avgRevenuePerMeeting ? 'Alta' : d.efficiency > avgRevenuePerMeeting * 0.5 ? 'Media' : 'Baja';
      return `<tr>
        <td><strong>${d.name}</strong></td>
        <td>${d.meetings}</td>
        <td>${d.deals}</td>
        <td><strong>${fmtFull(d.revenue)}</strong></td>
        <td>${fmtFull(d.efficiency)}</td>
        <td>${d.ratio > 0 ? d.ratio : '-'}</td>
        <td>${d.winRate}%</td>
        <td><span class="tag" style="background:${effColor}20;color:${effColor}">${effLabel}</span></td>
      </tr>`;
    }).join('')}
  </table>
</div>

<div class="chart-row">
  <div class="chart-card">
    <h3>Actividades por Ejecutivo (este mes)</h3>
    <div class="chart-wrap"><canvas id="actEjecChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Actividades por Tipo (este mes)</h3>
    <div class="chart-wrap"><canvas id="taskTypeChart2"></canvas></div>
  </div>
</div>

<div class="table-card">
  <h3>Win Rate por Ejecutivo (${year})</h3>
  <table>
    <tr><th>Ejecutivo</th><th>Ganadas</th><th>Perdidas</th><th>Win Rate</th><th></th></tr>
    ${winRateTable.map((d: any) => `<tr>
      <td>${d.name}</td>
      <td style="color:${COLORS.green}">${d.deals}</td>
      <td style="color:${COLORS.red}">${(winRateMap.get(Array.from(ownerIds).find(id => userNames.get(id)?.startsWith(d.fullName?.split(' ')[0] || '---')) || '') || { perdidas: 0 }).perdidas}</td>
      <td><strong>${d.winRate}%</strong></td>
      <td><div style="background:#e5e7eb;border-radius:4px;height:8px;width:120px"><div style="background:${d.winRate >= 50 ? COLORS.green : COLORS.red};height:8px;border-radius:4px;width:${Math.min(d.winRate, 100)}%"></div></div></td>
    </tr>`).join('')}
  </table>
</div>

<div class="chart-row">
  <div class="chart-card">
    <h3>Pronostico de Revenue por Reuniones (${year})</h3>
    <p style="font-size:11px;color:#6b7280;margin-bottom:12px">Linea roja = real. Linea azul punteada = proyeccion basada en ritmo de reuniones actual ($${Math.round(avgRevenuePerMeeting).toLocaleString()} por reunion).</p>
    <div class="chart-wrap"><canvas id="forecastChart"></canvas></div>
  </div>
</div>

<script>
const meses=${JSON.stringify(MONTHS)};
const fontDef={family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11};

// 1. Scatter: Meetings vs Revenue per rep
new Chart(document.getElementById('scatterChart'),{
  type:'bubble',
  data:{datasets:[{
    label:'Ejecutivos',
    data:${JSON.stringify(scatterData.map(d => ({ x: d.x, y: d.y, r: Math.max(4, Math.min(25, Math.sqrt(d.y / 50000))) })))},
    backgroundColor:'rgba(255,22,40,0.5)',
    borderColor:'${COLORS.red}',
    borderWidth:1.5
  }]},
  options:{responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){
      const d=${JSON.stringify(scatterData)};
      const item=d[c.dataIndex];
      return item?item.name+': '+item.x+' reuniones, $'+(item.y/1000000).toFixed(2)+'M':'';
    }}}},
    scales:{
      x:{title:{display:true,text:'Reuniones Comerciales',font:fontDef},ticks:{font:fontDef},grid:{color:'#f0f0f0'}},
      y:{title:{display:true,text:'Revenue (MXN)',font:fontDef},ticks:{callback:v=>'$'+(v/1000000).toFixed(1)+'M',font:fontDef},grid:{color:'#f0f0f0'}}
    }
  }
});

// 2. Trend: Meetings vs Sales by month (dual axis)
new Chart(document.getElementById('trendChart'),{
  type:'bar',
  data:{labels:meses.slice(0,${monthsElapsed}),datasets:[
    {type:'bar',label:'Reuniones',data:${JSON.stringify(monthlyMeetings.slice(0, monthsElapsed))},backgroundColor:'rgba(59,130,246,0.6)',borderRadius:4,yAxisID:'y'},
    {type:'line',label:'Ventas ($)',data:${JSON.stringify(monthlySales.slice(0, monthsElapsed))},borderColor:'${COLORS.red}',backgroundColor:'rgba(255,22,40,0.08)',fill:true,tension:0.4,borderWidth:2.5,pointRadius:4,yAxisID:'y1'}
  ]},
  options:{responsive:true,maintainAspectRatio:false,
    plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}}},
    scales:{
      y:{position:'left',title:{display:true,text:'Reuniones',font:fontDef},ticks:{font:fontDef},grid:{color:'#f0f0f0'}},
      y1:{position:'right',title:{display:true,text:'Ventas ($)',font:fontDef},ticks:{callback:v=>'$'+(v/1000000).toFixed(1)+'M',font:fontDef},grid:{display:false}},
      x:{ticks:{font:fontDef}}
    }
  }
});

// 3. Event types doughnut
new Chart(document.getElementById('eventTypeChart'),{
  type:'doughnut',
  data:{
    labels:${JSON.stringify([...clientEvents.map(e => e.type.replace('Reunión ','')), ...internalEvents.map(e => e.type)])},
    datasets:[{
      data:${JSON.stringify([...clientEvents.map(e => e.cnt), ...internalEvents.map(e => e.cnt)])},
      backgroundColor:['${COLORS.red}','${COLORS.blue}','#F97316','${COLORS.green}','#8B5CF6','${COLORS.gray}','#94a3b8','#cbd5e1','#e2e8f0']
    }]
  },
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:{...fontDef,size:10},boxWidth:8}}}}
});

// 4. Forecast chart
const realAccum=[];let acc=0;
${JSON.stringify(monthlySales)}.forEach((v,i)=>{acc+=v;if(i<${monthsElapsed})realAccum.push(acc);});
const projAccum=[];let pacc=0;
for(let i=0;i<12;i++){pacc+=${Math.round(avgRevenuePerMeeting * avgMeetingsPerMonth)};projAccum.push(pacc);}

new Chart(document.getElementById('forecastChart'),{
  type:'line',
  data:{labels:meses,datasets:[
    {label:'Real Acumulado',data:[...realAccum,...Array(12-realAccum.length).fill(null)],borderColor:'${COLORS.red}',backgroundColor:'rgba(255,22,40,0.08)',fill:true,tension:0.4,borderWidth:2.5,pointRadius:4},
    {label:'Proyeccion',data:projAccum,borderColor:'${COLORS.blue}',borderDash:[6,4],tension:0.4,borderWidth:2,pointRadius:2}
  ]},
  options:{responsive:true,maintainAspectRatio:false,
    plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}},tooltip:{callbacks:{label:c=>'$'+(c.parsed.y/1000000).toFixed(2)+'M'}}},
    scales:{y:{ticks:{callback:v=>'$'+(v/1000000).toFixed(0)+'M',font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef}}}
  }
});

// 5. Activities per exec (bar)
new Chart(document.getElementById('actEjecChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(actEjec.map((a: any) => a.name))},datasets:[{data:${JSON.stringify(actEjec.map((a: any) => a.cnt))},backgroundColor:'rgba(59,130,246,0.7)',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{font:fontDef}},y:{ticks:{font:{...fontDef,size:10}}}}}
});

// 6. Task types (second chart for activities section)
new Chart(document.getElementById('taskTypeChart2'),{
  type:'doughnut',
  data:{labels:${JSON.stringify(actTipo.map((a: any) => a.tipo === 'Task' ? 'Tarea' : a.tipo === 'Call' ? 'Llamada' : a.tipo))},datasets:[{data:${JSON.stringify(actTipo.map((a: any) => a.cnt))},backgroundColor:['${COLORS.blue}','${COLORS.green}','${COLORS.yellow}','${COLORS.red}','${COLORS.gray}']}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:fontDef,boxWidth:10}}}}
});

</script>`;

  return {
    id: 'comercial',
    title: 'Control Comercial',
    icon: '&#128188;',
    html: dashboardShell('Control Comercial - Eficiencia y Pronostico', date, body),
    generatedAt: now.toISOString(),
    summary: `${totalClientMeetings} reuniones comerciales | $${Math.round(avgRevenuePerMeeting).toLocaleString()}/reunion | Pronostico: ${fmt(projectedRevenueYear)}`,
  };
}

// ─── Report 5: Metas vs Real ─────────────────────────────────────────────────

async function generateMetas(query: QueryFn): Promise<ReportCache> {
  const now = new Date();
  const mesActual = now.toLocaleString('es-MX', { month: 'long' });

  const [metas, ventasPorEjec, ventasPorLDN] = await Promise.all([
    query(`SELECT Ejecutivo_de_venta__c ejec, Meta_Mensual__c meta, Porcentaje_de_alcance__c pct FROM Meta_de_venta__c WHERE CreatedDate = THIS_YEAR ORDER BY Meta_Mensual__c DESC NULLS LAST LIMIT 20`),
    query(`SELECT Owner.Name owner, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_MONTH AND CurrencyIsoCode = 'MXN' GROUP BY Owner.Name ORDER BY SUM(Amount) DESC LIMIT 15`),
    query(`SELECT Segm_Neg__c ldn, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' AND Segm_Neg__c != null GROUP BY Segm_Neg__c ORDER BY SUM(Amount) DESC`),
  ]);

  const ventasEjec = (ventasPorEjec.records || []).map((r: any) => ({ name: r.owner || 'Sin asignar', total: r.total || 0, cnt: r.cnt }));
  const ldnData = (ventasPorLDN.records || []).map((r: any) => ({ ldn: r.ldn, total: r.total || 0, cnt: r.cnt }));
  const totalMes = ventasEjec.reduce((s: number, v: any) => s + v.total, 0);

  const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const body = `
<div class="kpi-row">
  <div class="kpi">
    <div class="label">Venta del Mes (${mesActual})</div>
    <div class="value">${fmtFull(totalMes)}</div>
  </div>
  <div class="kpi">
    <div class="label">Ejecutivos con Venta</div>
    <div class="value">${ventasEjec.length}</div>
  </div>
  <div class="kpi">
    <div class="label">Segmentos Activos</div>
    <div class="value">${ldnData.length}</div>
  </div>
</div>

<div class="table-card">
  <h3>Ranking de Ejecutivos - ${mesActual} ${now.getFullYear()}</h3>
  <table>
    <tr><th>#</th><th>Ejecutivo</th><th>Venta</th><th>Opps</th><th></th></tr>
    ${ventasEjec.map((v: any, i: number) => `<tr><td><strong>${i + 1}</strong></td><td>${v.name}</td><td><strong>${fmtFull(v.total)}</strong></td><td>${v.cnt}</td><td><div style="background:#e5e7eb;border-radius:4px;height:8px;width:150px"><div style="background:${COLORS.red};height:8px;border-radius:4px;width:${ventasEjec[0]?.total ? Math.round((v.total / ventasEjec[0].total) * 100) : 0}%"></div></div></td></tr>`).join('')}
  </table>
</div>

<div class="chart-row">
  <div class="chart-card">
    <h3>Top Ejecutivos del Mes</h3>
    <div class="chart-wrap"><canvas id="topChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Venta por Segmento (LDN) - YTD</h3>
    <div class="chart-wrap"><canvas id="ldnChart"></canvas></div>
  </div>
</div>

<script>
const fontDef={family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11};

new Chart(document.getElementById('topChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(ventasEjec.slice(0, 10).map((v: any) => v.name.split(' ').slice(0, 2).join(' ')))},datasets:[{data:${JSON.stringify(ventasEjec.slice(0, 10).map((v: any) => v.total))},backgroundColor:'rgba(255,22,40,0.7)',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'$'+c.parsed.x.toLocaleString('es-MX')}}},scales:{x:{ticks:{callback:v=>'$'+(v/1000000).toFixed(1)+'M',font:fontDef}},y:{ticks:{font:{...fontDef,size:10}}}}}
});

new Chart(document.getElementById('ldnChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(ldnData.map((l: any) => l.ldn))},datasets:[{data:${JSON.stringify(ldnData.map((l: any) => l.total))},backgroundColor:['${COLORS.red}','${COLORS.blue}','${COLORS.green}','${COLORS.yellow}','${COLORS.gray}','#8B5CF6']}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'$'+(c.parsed.y/1000000).toFixed(2)+'M | '+${JSON.stringify(ldnData.map((l: any) => l.cnt))}[c.dataIndex]+' opps'}}},scales:{y:{ticks:{callback:v=>'$'+(v/1000000).toFixed(0)+'M',font:fontDef}},x:{ticks:{font:fontDef}}}}
});
</script>`;

  return {
    id: 'metas',
    title: 'Metas y Ranking',
    icon: '&#127942;',
    html: dashboardShell('Metas y Ranking de Ejecutivos', date, body),
    generatedAt: now.toISOString(),
    summary: `Venta del mes: ${fmt(totalMes)} | Top: ${ventasEjec[0]?.name || 'N/A'} (${fmt(ventasEjec[0]?.total || 0)})`,
  };
}

// ─── Report 6: Cobranza ──────────────────────────────────────────────────────

async function generateCobranza(query: QueryFn): Promise<ReportCache> {
  const now = new Date();

  const [porEstatus, porPolitica, topPendientes] = await Promise.all([
    query(`SELECT Estatus_de__c estatus, COUNT(Id) cnt, SUM(Importe_MXN__c) total FROM Invoice__c WHERE Estatus_de__c IN ('Emitido','Enviado','En Proceso de Pago','Programado','Solicitado') GROUP BY Estatus_de__c ORDER BY SUM(Importe_MXN__c) DESC`),
    query(`SELECT Pol_tica_de_Pago__c politica, COUNT(Id) cnt, SUM(Importe_MXN__c) total FROM Invoice__c WHERE Estatus_de__c IN ('Emitido','En Proceso de Pago') AND Pol_tica_de_Pago__c != null GROUP BY Pol_tica_de_Pago__c ORDER BY SUM(Importe_MXN__c) DESC`),
    query(`SELECT Name, Raz_n_Social__c acct, Importe_MXN__c total, Estatus_de__c estatus, Fecha_de_Emisi_n__c emision, Pol_tica_de_Pago__c politica FROM Invoice__c WHERE Estatus_de__c IN ('Emitido','Enviado','En Proceso de Pago','Solicitado') ORDER BY Importe_MXN__c DESC NULLS LAST LIMIT 15`),
  ]);

  const estatusData = (porEstatus.records || []).map((r: any) => ({ estatus: r.estatus, cnt: r.cnt, total: r.total || 0 }));
  const totalPendiente = estatusData.reduce((s: number, e: any) => s + e.total, 0);
  const totalFacturas = estatusData.reduce((s: number, e: any) => s + e.cnt, 0);

  const politicaData = (porPolitica.records || []).map((r: any) => ({ politica: r.politica, cnt: r.cnt, total: r.total || 0 }));

  const pendientes = (topPendientes.records || []).map((r: any) => ({
    name: r.Name, acct: r.acct, total: r.total || 0, estatus: r.estatus, emision: r.emision, politica: r.politica
  }));

  const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const estatusColors: Record<string, string> = { Emitido: COLORS.yellow, 'En Proceso de Pago': COLORS.blue, Programado: COLORS.green, 'Sin confirmacion': COLORS.red, Presupuestado: COLORS.gray };

  const body = `
<div class="kpi-row">
  <div class="kpi">
    <div class="label">Total Pendiente de Cobro</div>
    <div class="value" style="color:${COLORS.red}">${fmtFull(totalPendiente)}</div>
    <div class="sub">${totalFacturas} facturas</div>
  </div>
  ${estatusData.slice(0, 4).map((e: any) => `
  <div class="kpi">
    <div class="label">${e.estatus}</div>
    <div class="value">${fmtFull(e.total)}</div>
    <div class="sub">${e.cnt} facturas</div>
  </div>`).join('')}
</div>

<div class="chart-row">
  <div class="chart-card">
    <h3>Pendiente por Estatus</h3>
    <div class="chart-wrap"><canvas id="estatusChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Por Politica de Pago</h3>
    <div class="chart-wrap"><canvas id="politicaChart"></canvas></div>
  </div>
</div>

<div class="table-card">
  <h3>Top Facturas Pendientes</h3>
  <table>
    <tr><th>Factura</th><th>Cuenta</th><th>Monto</th><th>Estatus</th><th>Emision</th><th>Politica</th></tr>
    ${pendientes.map((p: any) => `<tr><td>${p.name || '-'}</td><td>${p.acct || '-'}</td><td><strong>${fmtFull(p.total)}</strong></td><td><span class="tag tag-${p.estatus === 'Emitido' ? 'yellow' : p.estatus?.includes('Proceso') ? 'blue' : 'red'}">${p.estatus}</span></td><td>${p.emision || '-'}</td><td>${p.politica || '-'}</td></tr>`).join('')}
  </table>
</div>

<script>
const fontDef={family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11};

new Chart(document.getElementById('estatusChart'),{
  type:'doughnut',
  data:{labels:${JSON.stringify(estatusData.map((e: any) => e.estatus))},datasets:[{data:${JSON.stringify(estatusData.map((e: any) => e.total))},backgroundColor:${JSON.stringify(estatusData.map((e: any) => estatusColors[e.estatus] || COLORS.gray))}}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:fontDef,boxWidth:10}},tooltip:{callbacks:{label:c=>'$'+(c.parsed/1000000).toFixed(2)+'M'}}}}
});

new Chart(document.getElementById('politicaChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(politicaData.map((p: any) => p.politica))},datasets:[{data:${JSON.stringify(politicaData.map((p: any) => p.total))},backgroundColor:'rgba(59,130,246,0.7)',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>'$'+(v/1000000).toFixed(1)+'M',font:fontDef}},x:{ticks:{font:fontDef}}}}
});
</script>`;

  return {
    id: 'cobranza',
    title: 'Cobranza',
    icon: '&#128179;',
    html: dashboardShell('Cobranza y Facturacion', date, body),
    generatedAt: now.toISOString(),
    summary: `Pendiente: ${fmt(totalPendiente)} (${totalFacturas} facturas)`,
  };
}

// ─── Report 7: Cuentas ───────────────────────────────────────────────────────

async function generateCuentas(query: QueryFn): Promise<ReportCache> {
  const now = new Date();

  const [porRegion, porSector, porTipo, cuentasNuevasMes] = await Promise.all([
    query(`SELECT Regi_n_Cliente_UEN__c region, COUNT(Id) cnt FROM Account WHERE Regi_n_Cliente_UEN__c != null GROUP BY Regi_n_Cliente_UEN__c ORDER BY COUNT(Id) DESC`),
    query(`SELECT Industry sector, COUNT(Id) cnt FROM Account WHERE Industry != null GROUP BY Industry ORDER BY COUNT(Id) DESC LIMIT 12`),
    query(`SELECT Tipo_de_Cuenta__c tipo, COUNT(Id) cnt FROM Account WHERE Tipo_de_Cuenta__c != null GROUP BY Tipo_de_Cuenta__c ORDER BY COUNT(Id) DESC`),
    query(`SELECT COUNT(Id) cnt FROM Account WHERE CreatedDate = THIS_MONTH`),
  ]);

  const regionData = (porRegion.records || []).map((r: any) => ({ region: r.region, cnt: r.cnt }));
  const sectorData = (porSector.records || []).map((r: any) => ({ sector: r.sector, cnt: r.cnt }));
  const tipoData = (porTipo.records || []).map((r: any) => ({ tipo: r.tipo, cnt: r.cnt }));
  const totalCuentas = tipoData.reduce((s: number, t: any) => s + t.cnt, 0);
  const nuevasMes = cuentasNuevasMes.records?.[0]?.cnt || 0;

  const tipoColors: Record<string, string> = {
    'Activo (Renewal)': COLORS.green, 'Perdido (Churn)': COLORS.red, 'Nuevo (New Logo)': COLORS.blue,
    'Recuperado (Winback)': '#8B5CF6', 'Sin actividad': COLORS.gray
  };

  const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const body = `
<div class="kpi-row">
  <div class="kpi">
    <div class="label">Total Cuentas</div>
    <div class="value">${totalCuentas.toLocaleString()}</div>
  </div>
  <div class="kpi">
    <div class="label">Nuevas este Mes</div>
    <div class="value" style="color:${COLORS.green}">${nuevasMes}</div>
  </div>
  ${tipoData.slice(0, 4).map((t: any) => `
  <div class="kpi">
    <div class="label">${t.tipo}</div>
    <div class="value" style="color:${tipoColors[t.tipo] || COLORS.dark}">${t.cnt.toLocaleString()}</div>
    <div class="sub">${pct(t.cnt, totalCuentas)}</div>
  </div>`).join('')}
</div>

<div class="chart-row">
  <div class="chart-card">
    <h3>Distribucion por Region</h3>
    <div class="chart-wrap"><canvas id="regionChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Tipo de Cuenta</h3>
    <div class="chart-wrap"><canvas id="tipoChart"></canvas></div>
  </div>
</div>

<div class="chart-row">
  <div class="chart-card" style="grid-column:1/-1">
    <h3>Top Sectores / Industrias</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="sectorChart"></canvas></div>
  </div>
</div>

<script>
const fontDef={family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11};

new Chart(document.getElementById('regionChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(regionData.map((r: any) => r.region.replace('Region ', '')))},datasets:[{data:${JSON.stringify(regionData.map((r: any) => r.cnt))},backgroundColor:'rgba(255,22,40,0.7)',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{font:fontDef}},y:{ticks:{font:{...fontDef,size:10}}}}}
});

new Chart(document.getElementById('tipoChart'),{
  type:'doughnut',
  data:{labels:${JSON.stringify(tipoData.map((t: any) => t.tipo))},datasets:[{data:${JSON.stringify(tipoData.map((t: any) => t.cnt))},backgroundColor:${JSON.stringify(tipoData.map((t: any) => tipoColors[t.tipo] || COLORS.gray))}}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:fontDef,boxWidth:10}}}}
});

new Chart(document.getElementById('sectorChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(sectorData.map((s: any) => s.sector.length > 25 ? s.sector.substring(0, 25) + '...' : s.sector))},datasets:[{data:${JSON.stringify(sectorData.map((s: any) => s.cnt))},backgroundColor:'rgba(59,130,246,0.7)',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{font:fontDef}},y:{ticks:{font:{...fontDef,size:10}}}}}
});
</script>`;

  return {
    id: 'cuentas',
    title: 'Distribucion de Cuentas',
    icon: '&#127970;',
    html: dashboardShell('Distribucion de Cuentas', date, body),
    generatedAt: now.toISOString(),
    summary: `${totalCuentas} cuentas | ${nuevasMes} nuevas este mes`,
  };
}

// ─── Main export: generate all reports ───────────────────────────────────────

export async function generateAllReports(query: QueryFn): Promise<ReportCache[]> {
  const generators = [
    generateEjecutivo,
    generateVentas,
    generatePipeline,
    generateComercial,
    generateMetas,
    generateCobranza,
    generateCuentas,
  ];

  const results: ReportCache[] = [];

  for (const gen of generators) {
    try {
      const report = await gen(query);
      results.push(report);
    } catch (err: any) {
      console.error(`Error generating report: ${err.message}`);
    }
  }

  return results;
}

export type { ReportCache };
