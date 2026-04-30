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

// ─── Report 1: Ejecutivo (Visión General estilo Power BI) ───────────────────
//
// Replica de la página "Visión General" del Power BI Master GPTW.
// Métricas: $ Venta, $ Facturación x Emisión, $ Venta Suscripción (LDN1+LDN4),
// $ Venta Soluciones (LDN2+LDN3), Esfuerzo Comercial, # Opp Totales, % Var Venta LY.

async function generateEjecutivo(query: QueryFn): Promise<ReportCache> {
  const now = new Date();
  const year = now.getFullYear();
  const lastYear = year - 1;

  const [
    ventasMesActual,      // Venta por mes año actual
    ventasMesAnterior,    // Venta por mes LY (mismo período)
    ventasLDN,            // Venta por LDN (Segm_Neg__c) año actual
    ventasLDNLY,          // Venta por LDN LY
    ventasEstatus,        // Venta por Estatus_anual__c
    ventasEstatusLY,      // Venta por Estatus_anual__c LY
    facturacionEmision,   // Facturación emitida YTD
    facturacionEmisionLY, // Facturación emitida LY
    esfuerzoMes,          // # opps creadas por mes (esfuerzo comercial)
    esfuerzoMesLY,        // # opps creadas por mes LY
    porProducto,          // Top 10 productos
    porLeadSource,        // Por canal (LeadSource)
    porTipoCuenta,        // Por Tipo_de_Cuenta__c (Activo, Nuevo, Perdido…)
    porStage,             // Por etapa
    topVendedores,        // Top 10 owners
    topCuentas,           // Top 10 cuentas
    porRango,             // Por Rango_de_Colaboradores__c (Categoría empresa)
    porRegion,            // Por Region__c
    cuentasTipo,          // Distribución cuentas (sin filtro de fecha)
  ] = await Promise.all([
    query(`SELECT CALENDAR_MONTH(CloseDate) mes, SUM(Amount) total FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY CALENDAR_MONTH(CloseDate)`),
    query(`SELECT CALENDAR_MONTH(CloseDate) mes, SUM(Amount) total FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = LAST_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY CALENDAR_MONTH(CloseDate)`),
    query(`SELECT Segm_Neg__c ldn, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' AND Segm_Neg__c != null GROUP BY Segm_Neg__c`),
    query(`SELECT Segm_Neg__c ldn, SUM(Amount) total FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = LAST_YEAR AND CurrencyIsoCode = 'MXN' AND Segm_Neg__c != null GROUP BY Segm_Neg__c`),
    query(`SELECT Estatus_anual__c tipo, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' AND Estatus_anual__c != null GROUP BY Estatus_anual__c`),
    query(`SELECT Estatus_anual__c tipo, SUM(Amount) total FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = LAST_YEAR AND CurrencyIsoCode = 'MXN' AND Estatus_anual__c != null GROUP BY Estatus_anual__c`),
    query(`SELECT CALENDAR_MONTH(Fecha_de_Emision__c) mes, SUM(Total__c) total FROM Invoice__c WHERE Fecha_de_Emision__c = THIS_YEAR AND Estatus__c != 'Cancelado' GROUP BY CALENDAR_MONTH(Fecha_de_Emision__c)`),
    query(`SELECT CALENDAR_MONTH(Fecha_de_Emision__c) mes, SUM(Total__c) total FROM Invoice__c WHERE Fecha_de_Emision__c = LAST_YEAR AND Estatus__c != 'Cancelado' GROUP BY CALENDAR_MONTH(Fecha_de_Emision__c)`),
    query(`SELECT CALENDAR_MONTH(CreatedDate) mes, COUNT(Id) cnt FROM Opportunity WHERE CreatedDate = THIS_YEAR GROUP BY CALENDAR_MONTH(CreatedDate)`),
    query(`SELECT CALENDAR_MONTH(CreatedDate) mes, COUNT(Id) cnt FROM Opportunity WHERE CreatedDate = LAST_YEAR GROUP BY CALENDAR_MONTH(CreatedDate)`),
    query(`SELECT Product2.Name prod, SUM(TotalPrice) total, COUNT(Id) cnt FROM OpportunityLineItem WHERE Opportunity.StageName = 'Ganada!' AND Opportunity.CloseDate = THIS_YEAR AND Opportunity.CurrencyIsoCode = 'MXN' GROUP BY Product2.Name ORDER BY SUM(TotalPrice) DESC LIMIT 10`),
    query(`SELECT LeadSource src, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' AND LeadSource != null GROUP BY LeadSource ORDER BY SUM(Amount) DESC LIMIT 10`),
    query(`SELECT Account.Tipo_de_Cuenta__c tipo, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY Account.Tipo_de_Cuenta__c`),
    query(`SELECT StageName stage, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY StageName ORDER BY SUM(Amount) DESC`),
    query(`SELECT Owner.Name vendedor, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY Owner.Name ORDER BY SUM(Amount) DESC LIMIT 10`),
    query(`SELECT Account.Name cuenta, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY Account.Name ORDER BY SUM(Amount) DESC LIMIT 10`),
    query(`SELECT Account.Rango_de_Colaboradores__c rango, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' AND Account.Rango_de_Colaboradores__c != null GROUP BY Account.Rango_de_Colaboradores__c ORDER BY SUM(Amount) DESC`),
    query(`SELECT Account.Regi_n_Cliente_UEN__c region, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' AND Account.Regi_n_Cliente_UEN__c != null GROUP BY Account.Regi_n_Cliente_UEN__c ORDER BY SUM(Amount) DESC`),
    query(`SELECT Tipo_de_Cuenta__c tipo, COUNT(Id) cnt FROM Account WHERE Tipo_de_Cuenta__c != null GROUP BY Tipo_de_Cuenta__c ORDER BY COUNT(Id) DESC`),
  ]);

  function getMonthNum(rec: any): number | null {
    for (const k of Object.keys(rec)) {
      if (k === 'attributes' || k === 'total' || k === 'cnt') continue;
      const v = Number(rec[k]); if (!isNaN(v) && v >= 1 && v <= 12) return v;
    }
    return null;
  }

  // Build monthly data arrays — all 12 months, filtros client-side
  const monthVenta = new Array(12).fill(0);
  const monthVentaLY = new Array(12).fill(0);
  const monthFact = new Array(12).fill(0);
  const monthFactLY = new Array(12).fill(0);
  const monthEsfuerzo = new Array(12).fill(0);
  const monthEsfuerzoLY = new Array(12).fill(0);

  (ventasMesActual.records || []).forEach((r: any) => { const m = getMonthNum(r); if (m) monthVenta[m - 1] = r.total || 0; });
  (ventasMesAnterior.records || []).forEach((r: any) => { const m = getMonthNum(r); if (m) monthVentaLY[m - 1] = r.total || 0; });
  (facturacionEmision.records || []).forEach((r: any) => { const m = getMonthNum(r); if (m) monthFact[m - 1] = r.total || 0; });
  (facturacionEmisionLY.records || []).forEach((r: any) => { const m = getMonthNum(r); if (m) monthFactLY[m - 1] = r.total || 0; });
  (esfuerzoMes.records || []).forEach((r: any) => { const m = getMonthNum(r); if (m) monthEsfuerzo[m - 1] = r.cnt || 0; });
  (esfuerzoMesLY.records || []).forEach((r: any) => { const m = getMonthNum(r); if (m) monthEsfuerzoLY[m - 1] = r.cnt || 0; });

  // LDN breakdown — Suscripción = LDN1+LDN4, Soluciones = LDN2+LDN3 (medidas DAX)
  const ldnRecs = (ventasLDN.records || []) as any[];
  const ldnLYRecs = (ventasLDNLY.records || []) as any[];
  const ldnTotal = (records: any[], match: string[]) => records
    .filter(r => match.some(m => (r.ldn || '').includes(m)))
    .reduce((s, r) => s + (r.total || 0), 0);

  const ventaSuscripcion = ldnTotal(ldnRecs, ['LDN 1', 'LDN 4']);
  const ventaSoluciones = ldnTotal(ldnRecs, ['LDN 2', 'LDN 3']);
  const ventaSuscripcionLY = ldnTotal(ldnLYRecs, ['LDN 1', 'LDN 4']);
  const ventaSolucionesLY = ldnTotal(ldnLYRecs, ['LDN 2', 'LDN 3']);

  // Cuentas distribución
  const cuentasData = (cuentasTipo.records || []).map((r: any) => ({ tipo: r.tipo, cnt: r.cnt }));
  const cuentasActivas = cuentasData.find((c: any) => c.tipo?.includes('Activo'))?.cnt || 0;
  const cuentasPerdidas = cuentasData.find((c: any) => c.tipo?.includes('Perdido'))?.cnt || 0;

  // Estatus_anual (Nuevo/Renovación/Adicional)
  const estatusActual = (ventasEstatus.records || []).map((r: any) => ({ tipo: r.tipo, total: r.total || 0, cnt: r.cnt }));
  const estatusLY = (ventasEstatusLY.records || []).map((r: any) => ({ tipo: r.tipo, total: r.total || 0 }));

  // Top tablas
  const topVend = (topVendedores.records || []).map((r: any) => ({ name: r.vendedor, total: r.total || 0, cnt: r.cnt }));
  const topAcc = (topCuentas.records || []).map((r: any) => ({ name: r.cuenta, total: r.total || 0, cnt: r.cnt }));
  const productos = (porProducto.records || []).map((r: any) => ({ name: r.prod, total: r.total || 0, cnt: r.cnt }));
  const leadSources = (porLeadSource.records || []).map((r: any) => ({ name: r.src, total: r.total || 0, cnt: r.cnt }));
  const tipoCuenta = (porTipoCuenta.records || []).map((r: any) => ({ name: r.tipo || 'Sin tipo', total: r.total || 0, cnt: r.cnt }));
  const stages = (porStage.records || []).map((r: any) => ({ name: r.stage, total: r.total || 0, cnt: r.cnt }));
  const rangos = (porRango.records || []).map((r: any) => ({ name: r.rango, total: r.total || 0, cnt: r.cnt }));
  const regiones = (porRegion.records || []).map((r: any) => ({ name: r.region, total: r.total || 0, cnt: r.cnt }));

  const totalYTD = monthVenta.reduce((a, b) => a + b, 0);
  const totalLY = monthVentaLY.reduce((a, b) => a + b, 0);
  const yoyChange = pctChange(totalYTD, totalLY);

  const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const currentMonth = now.getMonth();

  // ─── HTML ─────────────────────────────────────────────────────────────────
  const tableRows = (rows: any[], col1: string, formatTotal = true) => rows.map(r => `
    <tr><td>${(r.name || '—').toString().replace(/</g, '&lt;')}</td><td style="text-align:right">${formatTotal ? fmtFull(r.total) : (r.total || 0).toLocaleString('es-MX')}</td><td style="text-align:right;color:#6B7280">${(r.cnt || 0).toLocaleString('es-MX')}</td></tr>
  `).join('');

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

<!-- KPIs (replica de las cards de Power BI: $ Venta, $ Facturación x Emisión, $ Venta Suscripción, $ Venta Soluciones, Esfuerzo Comercial, # Opp Totales, % Var Venta LY) -->
<div class="kpi-row" id="kpiRow"></div>

<!-- ROW 1: Venta mensual (column con LY tooltip) + Esfuerzo Comercial (line) + Venta YTD por LDN (donut) -->
<div class="chart-row" style="grid-template-columns:2fr 1.2fr 1fr">
  <div class="chart-card">
    <h3 id="monthTitle">Venta por Mes ${year} vs ${lastYear}</h3>
    <div class="chart-wrap" style="height:280px"><canvas id="monthChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3 id="esfuerzoTitle">Esfuerzo Comercial (Opps Creadas)</h3>
    <div class="chart-wrap" style="height:280px"><canvas id="esfuerzoChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Venta por Tipo (Estatus Anual)</h3>
    <div class="chart-wrap" style="height:280px"><canvas id="estatusChart"></canvas></div>
  </div>
</div>

<!-- ROW 2: Venta acumulada (line full width) -->
<div class="chart-row">
  <div class="chart-card" style="grid-column:1/-1">
    <h3 id="accumTitle">Venta Acumulada ${year}</h3>
    <div class="chart-wrap" style="height:260px"><canvas id="accumChart"></canvas></div>
  </div>
</div>

<!-- ROW 3: Categoría empresa (rangos colaboradores) + Producto + LeadSource + Región -->
<div class="chart-row" style="grid-template-columns:1fr 1fr 1fr 1fr">
  <div class="chart-card">
    <h3>Venta por Categoría Empresa</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="rangoChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Top Productos</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="productoChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Venta por Canal (LeadSource)</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="canalChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Venta por Región</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="regionChart"></canvas></div>
  </div>
</div>

<!-- ROW 4: Tablas Top vendedores + Top cuentas -->
<div class="chart-row" style="grid-template-columns:1fr 1fr">
  <div class="table-card">
    <h3>Top 10 Vendedores YTD</h3>
    <table>
      <thead><tr><th>Vendedor</th><th style="text-align:right">$ Venta</th><th style="text-align:right"># Opp</th></tr></thead>
      <tbody>${tableRows(topVend, 'Vendedor')}</tbody>
    </table>
  </div>
  <div class="table-card">
    <h3>Top 10 Cuentas YTD</h3>
    <table>
      <thead><tr><th>Cuenta</th><th style="text-align:right">$ Venta</th><th style="text-align:right"># Opp</th></tr></thead>
      <tbody>${tableRows(topAcc, 'Cuenta')}</tbody>
    </table>
  </div>
</div>

<!-- ROW 5: Tablas Stage + Tipo de Cuenta -->
<div class="chart-row" style="grid-template-columns:1fr 1fr">
  <div class="table-card">
    <h3>Por Etapa de Oportunidad ${year}</h3>
    <table>
      <thead><tr><th>Etapa</th><th style="text-align:right">$ Total</th><th style="text-align:right"># Opp</th></tr></thead>
      <tbody>${tableRows(stages, 'Etapa')}</tbody>
    </table>
  </div>
  <div class="table-card">
    <h3>Por Tipo de Cuenta YTD</h3>
    <table>
      <thead><tr><th>Tipo</th><th style="text-align:right">$ Venta</th><th style="text-align:right"># Opp</th></tr></thead>
      <tbody>${tableRows(tipoCuenta, 'Tipo')}</tbody>
    </table>
  </div>
</div>

<script>
// ── Raw data (all 12 months) ──
const MESES = ${JSON.stringify(MONTHS)};
const VENTA = ${JSON.stringify(monthVenta)};
const VENTA_LY = ${JSON.stringify(monthVentaLY)};
const FACT = ${JSON.stringify(monthFact)};
const FACT_LY = ${JSON.stringify(monthFactLY)};
const ESFUERZO = ${JSON.stringify(monthEsfuerzo)};
const ESFUERZO_LY = ${JSON.stringify(monthEsfuerzoLY)};
const YEAR = ${year};
const LAST_YEAR = ${lastYear};

const VENTA_SUSCRIPCION = ${ventaSuscripcion};
const VENTA_SOLUCIONES = ${ventaSoluciones};
const VENTA_SUSCRIPCION_LY = ${ventaSuscripcionLY};
const VENTA_SOLUCIONES_LY = ${ventaSolucionesLY};
const ESTATUS_ACTUAL = ${JSON.stringify(estatusActual)};
const ESTATUS_LY = ${JSON.stringify(estatusLY)};

const PRODUCTOS = ${JSON.stringify(productos)};
const LEADSOURCES = ${JSON.stringify(leadSources)};
const RANGOS = ${JSON.stringify(rangos)};
const REGIONES = ${JSON.stringify(regiones)};

const fontDef = {family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11};
const fontSm = {family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:10};

function fmt(n){if(n==null||isNaN(n))return'$0';if(Math.abs(n)>=1e6)return'$'+(n/1e6).toFixed(1)+'M';if(Math.abs(n)>=1e3)return'$'+(n/1e3).toFixed(0)+'K';return'$'+n.toFixed(0)}
function fmtFull(n){return'$'+(n||0).toLocaleString('es-MX',{maximumFractionDigits:0})}

let monthChart, esfuerzoChart, estatusChart, accumChart, rangoChart, productoChart, canalChart, regionChart;

function initCharts(){
  monthChart = new Chart(document.getElementById('monthChart'),{type:'bar',data:{labels:[],datasets:[]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+fmt(c.parsed.y)}}},scales:{y:{ticks:{callback:v=>fmt(v),font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef},grid:{display:false}}}}});
  esfuerzoChart = new Chart(document.getElementById('esfuerzoChart'),{type:'line',data:{labels:[],datasets:[]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}}},scales:{y:{beginAtZero:true,ticks:{font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef},grid:{display:false}}}}});
  estatusChart = new Chart(document.getElementById('estatusChart'),{type:'doughnut',data:{labels:[],datasets:[]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:fontSm,boxWidth:10}},tooltip:{callbacks:{label:c=>c.label+': '+fmt(c.parsed)}}}}});
  accumChart = new Chart(document.getElementById('accumChart'),{type:'line',data:{labels:[],datasets:[]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+fmt(c.parsed.y)}}},scales:{y:{ticks:{callback:v=>fmt(v),font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef},grid:{display:false}}}}});

  // Static charts
  rangoChart = new Chart(document.getElementById('rangoChart'),{type:'bar',data:{labels:RANGOS.map(r=>r.name),datasets:[{label:'$ Venta',data:RANGOS.map(r=>r.total),backgroundColor:'${COLORS.red}',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.parsed.x)}}},scales:{x:{ticks:{callback:v=>fmt(v),font:fontSm},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontSm},grid:{display:false}}}}});
  productoChart = new Chart(document.getElementById('productoChart'),{type:'bar',data:{labels:PRODUCTOS.map(p=>p.name),datasets:[{label:'$ Venta',data:PRODUCTOS.map(p=>p.total),backgroundColor:'${COLORS.blue}',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.parsed.x)}}},scales:{x:{ticks:{callback:v=>fmt(v),font:fontSm},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontSm},grid:{display:false}}}}});
  canalChart = new Chart(document.getElementById('canalChart'),{type:'bar',data:{labels:LEADSOURCES.map(l=>l.name),datasets:[{label:'$ Venta',data:LEADSOURCES.map(l=>l.total),backgroundColor:'${COLORS.green}',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.parsed.x)}}},scales:{x:{ticks:{callback:v=>fmt(v),font:fontSm},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontSm},grid:{display:false}}}}});
  regionChart = new Chart(document.getElementById('regionChart'),{type:'bar',data:{labels:REGIONES.map(r=>r.name),datasets:[{label:'$ Venta',data:REGIONES.map(r=>r.total),backgroundColor:'${COLORS.yellow}',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.parsed.x)}}},scales:{x:{ticks:{callback:v=>fmt(v),font:fontSm},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontSm},grid:{display:false}}}}});

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

  const labels = MESES.slice(start, end+1);
  const venta = VENTA.slice(start, end+1);
  const ventaLY = VENTA_LY.slice(start, end+1);
  const fact = FACT.slice(start, end+1);
  const factLY = FACT_LY.slice(start, end+1);
  const esf = ESFUERZO.slice(start, end+1);
  const esfLY = ESFUERZO_LY.slice(start, end+1);

  // Acumular
  let accCur=0, accLY=0;
  const accumCur = venta.map(v=>(accCur+=v,accCur));
  const accumLY = ventaLY.map(v=>(accLY+=v,accLY));

  // Totales
  const totalVenta = venta.reduce((s,v)=>s+v,0);
  const totalVentaLY = ventaLY.reduce((s,v)=>s+v,0);
  const totalFact = fact.reduce((s,v)=>s+v,0);
  const totalFactLY = factLY.reduce((s,v)=>s+v,0);
  const totalEsf = esf.reduce((s,v)=>s+v,0);
  const totalEsfLY = esfLY.reduce((s,v)=>s+v,0);

  const monthCount = end-start+1;
  const fullPeriod = (start===0 && end===11);

  // % Var
  const pctChg = totalVentaLY>0 ? ((totalVenta-totalVentaLY)/totalVentaLY*100) : 0;
  const chgColor = pctChg>=0?'${COLORS.green}':'${COLORS.red}';
  const chgArrow = pctChg>=0?'&#9650;':'&#9660;';
  const pctChgFact = totalFactLY>0 ? ((totalFact-totalFactLY)/totalFactLY*100) : 0;
  const factColor = pctChgFact>=0?'${COLORS.green}':'${COLORS.red}';

  // Suscripcion / Soluciones (proporcionales si filtramos un período)
  const suscripcion = fullPeriod ? VENTA_SUSCRIPCION : VENTA_SUSCRIPCION * (totalVenta/(${totalYTD}||1));
  const soluciones = fullPeriod ? VENTA_SOLUCIONES : VENTA_SOLUCIONES * (totalVenta/(${totalYTD}||1));

  // Render KPIs (replica visual de las 7 cards Power BI)
  document.getElementById('kpiRow').innerHTML = \`
    <div class="kpi" style="border-top:3px solid ${COLORS.red}">
      <div class="label">$ Venta</div>
      <div class="value">\${fmtFull(totalVenta)}</div>
      \${showLY?\`<div class="sub" style="color:\${chgColor}">\${chgArrow} \${pctChg>=0?'+':''}\${pctChg.toFixed(1)}% vs \${LAST_YEAR}</div>\`:''}
    </div>
    <div class="kpi" style="border-top:3px solid ${COLORS.blue}">
      <div class="label">$ Facturación x Emisión</div>
      <div class="value">\${fmtFull(totalFact)}</div>
      \${showLY?\`<div class="sub" style="color:\${factColor}">\${pctChgFact>=0?'+':''}\${pctChgFact.toFixed(1)}% vs LY</div>\`:''}
    </div>
    <div class="kpi" style="border-top:3px solid ${COLORS.green}">
      <div class="label">$ Venta Suscripción <span style="color:#9CA3AF;font-size:9px">(LDN1+LDN4)</span></div>
      <div class="value">\${fmt(suscripcion)}</div>
      <div class="sub" style="color:#6B7280">\${totalVenta>0?((suscripcion/totalVenta)*100).toFixed(0):0}% del total</div>
    </div>
    <div class="kpi" style="border-top:3px solid ${COLORS.yellow}">
      <div class="label">$ Venta Soluciones <span style="color:#9CA3AF;font-size:9px">(LDN2+LDN3)</span></div>
      <div class="value">\${fmt(soluciones)}</div>
      <div class="sub" style="color:#6B7280">\${totalVenta>0?((soluciones/totalVenta)*100).toFixed(0):0}% del total</div>
    </div>
    <div class="kpi" style="border-top:3px solid ${COLORS.dark}">
      <div class="label">Esfuerzo Comercial</div>
      <div class="value">\${totalEsf.toLocaleString('es-MX')}</div>
      \${showLY?\`<div class="sub" style="color:#6B7280">vs \${totalEsfLY.toLocaleString('es-MX')} \${LAST_YEAR}</div>\`:'<div class="sub">opps creadas</div>'}
    </div>
    <div class="kpi" style="border-top:3px solid ${COLORS.gray}">
      <div class="label">Cuentas Activas</div>
      <div class="value">${cuentasActivas.toLocaleString('es-MX')}</div>
      <div class="sub"><span class="tag tag-green">Renewal</span> ${cuentasPerdidas.toLocaleString('es-MX')} <span style="color:#6B7280">churn</span></div>
    </div>
    <div class="kpi" style="border-top:3px solid ${COLORS.red}">
      <div class="label">Promedio Mensual</div>
      <div class="value">\${fmt(totalVenta/(monthCount||1))}</div>
      <div class="sub" style="color:#6B7280">\${monthCount} \${monthCount===1?'mes':'meses'}</div>
    </div>
  \`;

  // Chart 1: Venta mensual
  document.getElementById('monthTitle').textContent = 'Venta por Mes ' + MESES[start] + '-' + MESES[end] + ' ' + YEAR;
  monthChart.data.labels = labels;
  monthChart.data.datasets = [{label:YEAR+'',data:venta,backgroundColor:'rgba(255,22,40,0.85)',borderRadius:4}];
  if(showLY) monthChart.data.datasets.push({label:LAST_YEAR+'',data:ventaLY,backgroundColor:'rgba(59,130,246,0.55)',borderRadius:4});
  monthChart.update();

  // Chart 2: Esfuerzo Comercial (line)
  document.getElementById('esfuerzoTitle').textContent = 'Esfuerzo Comercial (Opps Creadas)';
  esfuerzoChart.data.labels = labels;
  esfuerzoChart.data.datasets = [{label:YEAR+'',data:esf,borderColor:'${COLORS.dark}',backgroundColor:'rgba(17,19,28,0.1)',fill:true,tension:0.4,borderWidth:2.5,pointRadius:3}];
  if(showLY) esfuerzoChart.data.datasets.push({label:LAST_YEAR+'',data:esfLY,borderColor:'${COLORS.gray}',borderDash:[5,5],fill:false,tension:0.4,borderWidth:2,pointRadius:2});
  esfuerzoChart.update();

  // Chart 3: Estatus_anual (donut)
  estatusChart.data.labels = ESTATUS_ACTUAL.map(e=>e.tipo);
  estatusChart.data.datasets = [{data:ESTATUS_ACTUAL.map(e=>e.total),backgroundColor:['${COLORS.blue}','${COLORS.green}','${COLORS.yellow}','${COLORS.red}','${COLORS.gray}']}];
  estatusChart.update();

  // Chart 4: Acumulado
  document.getElementById('accumTitle').textContent = 'Venta Acumulada ' + MESES[start] + ' - ' + MESES[end] + ' ' + YEAR;
  accumChart.data.labels = labels;
  accumChart.data.datasets = [{label:YEAR+'',data:accumCur,borderColor:'${COLORS.red}',backgroundColor:'rgba(255,22,40,0.08)',fill:true,tension:0.4,borderWidth:2.5,pointRadius:3}];
  if(showLY) accumChart.data.datasets.push({label:LAST_YEAR+'',data:accumLY,borderColor:'${COLORS.blue}',backgroundColor:'rgba(59,130,246,0.05)',fill:true,tension:0.4,borderWidth:2,borderDash:[5,5],pointRadius:2});
  accumChart.update();
}

initCharts();
</script>`;

  return {
    id: 'ejecutivo',
    title: 'Dashboard Ejecutivo',
    icon: '&#128200;',
    html: dashboardShell(`Dashboard Ejecutivo - ${year}`, date, body),
    generatedAt: now.toISOString(),
    summary: `Venta YTD: ${fmt(totalYTD)} (${yoyChange.text} vs ${lastYear}) | Suscripción: ${fmt(ventaSuscripcion)} | Soluciones: ${fmt(ventaSoluciones)} | Cuentas activas: ${cuentasActivas}`,
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

// ─── Report 3: Pipeline y Oportunidades (réplica de "Oportunidades" del PBI) ─

async function generatePipeline(query: QueryFn): Promise<ReportCache> {
  const now = new Date();
  const year = now.getFullYear();
  const lastYear = year - 1;

  const [
    porEtapa,         // Pipeline por StageName (abiertas)
    porLDN,           // Pipeline por Segm_Neg__c
    porEstatus,       // Pipeline por Estatus_anual__c
    semaforo,         // Pipeline por Sem_foro_de_gesti_n__c
    porLeadSource,    // Pipeline por LeadSource
    forecastMes,      // Forecast por mes (CloseDate de abiertas)
    espuerzoMes,      // # opps creadas por mes este año
    esfuerzoMesLY,    // # opps creadas LY
    topOppsAbiertas,  // Detalle top 20 abiertas (con todos los campos)
    topVendedoresPip, // Top vendedores por $ pipeline
    topCuentasPip,    // Top cuentas con pipeline
    motivosPerdida,   // Razones de pérdida YTD
    winRateData,      // Ganadas vs Perdidas YTD
    proxCierres,      // Próximos 30 días
    accountCount,     // # cuentas distintas con pipeline
  ] = await Promise.all([
    query(`SELECT StageName s, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' GROUP BY StageName ORDER BY SUM(Amount) DESC`),
    query(`SELECT Segm_Neg__c ldn, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' AND Segm_Neg__c != null GROUP BY Segm_Neg__c ORDER BY SUM(Amount) DESC`),
    query(`SELECT Estatus_anual__c tipo, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' AND Estatus_anual__c != null GROUP BY Estatus_anual__c`),
    query(`SELECT Sem_foro_de_gesti_n__c sem, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' AND Sem_foro_de_gesti_n__c != null GROUP BY Sem_foro_de_gesti_n__c`),
    query(`SELECT LeadSource src, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' AND LeadSource != null GROUP BY LeadSource ORDER BY SUM(Amount) DESC LIMIT 10`),
    query(`SELECT CALENDAR_YEAR(CloseDate) y, CALENDAR_MONTH(CloseDate) mes, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' GROUP BY CALENDAR_YEAR(CloseDate), CALENDAR_MONTH(CloseDate) ORDER BY CALENDAR_YEAR(CloseDate), CALENDAR_MONTH(CloseDate)`),
    query(`SELECT CALENDAR_MONTH(CreatedDate) mes, COUNT(Id) cnt FROM Opportunity WHERE CreatedDate=THIS_YEAR GROUP BY CALENDAR_MONTH(CreatedDate)`),
    query(`SELECT CALENDAR_MONTH(CreatedDate) mes, COUNT(Id) cnt FROM Opportunity WHERE CreatedDate=LAST_YEAR GROUP BY CALENDAR_MONTH(CreatedDate)`),
    query(`SELECT Id, Name, Account.Name a, Amount, StageName, Probability, CloseDate, Owner.Name o, Sem_foro_de_gesti_n__c sem, Segm_Neg__c ldn, Estatus_anual__c et FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' ORDER BY Amount DESC NULLS LAST LIMIT 20`),
    query(`SELECT Owner.Name v, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' GROUP BY Owner.Name ORDER BY SUM(Amount) DESC LIMIT 10`),
    query(`SELECT Account.Name a, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' GROUP BY Account.Name ORDER BY SUM(Amount) DESC LIMIT 10`),
    query(`SELECT Razon_de__c motivo, COUNT(Id) cnt, SUM(Amount) total FROM Opportunity WHERE StageName='Perdida' AND CloseDate=THIS_YEAR AND Razon_de__c != null GROUP BY Razon_de__c ORDER BY COUNT(Id) DESC LIMIT 10`),
    query(`SELECT StageName s, COUNT(Id) cnt, SUM(Amount) total FROM Opportunity WHERE CloseDate=THIS_YEAR AND StageName IN ('Ganada!','Perdida','Cancelada') GROUP BY StageName`),
    query(`SELECT Id FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' AND CloseDate <= NEXT_N_DAYS:30`),
    query(`SELECT COUNT_DISTINCT(AccountId) cnt FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN'`),
  ]);

  function getMon(rec: any): number | null {
    for (const k of Object.keys(rec)) {
      if (k === 'attributes' || k === 'total' || k === 'cnt' || k === 'y') continue;
      const v = Number(rec[k]); if (!isNaN(v) && v >= 1 && v <= 12) return v;
    }
    return null;
  }

  // KPIs
  const etapas = (porEtapa.records || []).map((r: any) => ({ name: r.s, total: r.total || 0, cnt: r.cnt }));
  const totalPipeline = etapas.reduce((s: number, e: any) => s + e.total, 0);
  const totalOpps = etapas.reduce((s: number, e: any) => s + e.cnt, 0);
  const avgDeal = totalOpps > 0 ? totalPipeline / totalOpps : 0;
  const cuentasPipeline = accountCount.records?.[0]?.cnt || 0;

  // Win rate
  const wrRecs = (winRateData.records || []) as any[];
  const ganadas = wrRecs.find((r: any) => r.s === 'Ganada!')?.cnt || 0;
  const perdidas = wrRecs.find((r: any) => r.s === 'Perdida')?.cnt || 0;
  const canceladas = wrRecs.find((r: any) => r.s === 'Cancelada')?.cnt || 0;
  const winRate = (ganadas + perdidas) > 0 ? (ganadas / (ganadas + perdidas)) * 100 : 0;
  const ventasYTD = wrRecs.find((r: any) => r.s === 'Ganada!')?.total || 0;
  const proxCierreCnt = (proxCierres.records || []).length;

  // Pipeline ponderado (Amount × Probability/100) — pakado de la tabla detalle
  const detalleAbiertas = (topOppsAbiertas.records || []) as any[];
  // Para el ponderado de TODA la pipeline, lo aproximamos con un % implícito por stage.
  // Mejor: usamos el cnt/total del tope detallado (top 20) — pero eso es solo una muestra.
  // Para precisión: sumamos el ponderado de las top 20 y mostramos como referencia.

  const ldnData = (porLDN.records || []).map((r: any) => ({ name: r.ldn, total: r.total || 0, cnt: r.cnt }));
  const estatusData = (porEstatus.records || []).map((r: any) => ({ name: r.tipo, total: r.total || 0, cnt: r.cnt }));
  const semData = (semaforo.records || []).map((r: any) => ({ name: r.sem, total: r.total || 0, cnt: r.cnt }));
  const leadSrcData = (porLeadSource.records || []).map((r: any) => ({ name: r.src, total: r.total || 0, cnt: r.cnt }));

  // Forecast por mes (próximos 12 meses desde hoy)
  const forecastByMonth: Record<string, number> = {};
  (forecastMes.records || []).forEach((r: any) => {
    const yr = r.y;
    const mn = getMon(r);
    if (yr && mn) {
      const key = `${yr}-${String(mn).padStart(2, '0')}`;
      forecastByMonth[key] = (forecastByMonth[key] || 0) + (r.total || 0);
    }
  });
  const forecastEntries = Object.entries(forecastByMonth)
    .filter(([k]) => k >= now.toISOString().slice(0, 7))
    .sort()
    .slice(0, 12);

  // Esfuerzo comercial mensual
  const esfMonths = new Array(12).fill(0);
  const esfMonthsLY = new Array(12).fill(0);
  (espuerzoMes.records || []).forEach((r: any) => { const m = getMon(r); if (m) esfMonths[m - 1] = r.cnt || 0; });
  (esfuerzoMesLY.records || []).forEach((r: any) => { const m = getMon(r); if (m) esfMonthsLY[m - 1] = r.cnt || 0; });

  // Top tablas
  const topVend = (topVendedoresPip.records || []).map((r: any) => ({ name: r.v || '—', total: r.total || 0, cnt: r.cnt }));
  const topCuentas = (topCuentasPip.records || []).map((r: any) => ({ name: r.a || '—', total: r.total || 0, cnt: r.cnt }));
  const motivos = (motivosPerdida.records || []).map((r: any) => ({ name: r.motivo, total: r.total || 0, cnt: r.cnt }));

  const detalleTop = detalleAbiertas.map((r: any) => ({
    id: r.Id, name: r.Name, acct: r.a || '—', amount: r.Amount || 0,
    stage: r.StageName, prob: r.Probability || 0, close: r.CloseDate || '—',
    owner: r.o || '—', sem: r.sem || '—', ldn: r.ldn || '—', estatus: r.et || '—'
  }));

  const semColors: Record<string, string> = { Verde: COLORS.green, Amarillo: COLORS.yellow, Rojo: COLORS.red, Azul: COLORS.blue };
  const semTagClass = (s: string) => s === 'Verde' ? 'tag-green' : s === 'Amarillo' ? 'tag-yellow' : s === 'Rojo' ? 'tag-red' : 'tag-blue';

  const tableRows = (rows: any[]) => rows.map(r => `
    <tr><td>${(r.name || '—').toString().replace(/</g, '&lt;')}</td><td style="text-align:right">${fmtFull(r.total)}</td><td style="text-align:right;color:#6B7280">${(r.cnt || 0).toLocaleString('es-MX')}</td></tr>
  `).join('');

  const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const body = `
<!-- KPIs -->
<div class="kpi-row">
  <div class="kpi" style="border-top:3px solid ${COLORS.red}">
    <div class="label">$ Pipeline Total</div>
    <div class="value">${fmtFull(totalPipeline)}</div>
    <div class="sub">${totalOpps.toLocaleString('es-MX')} opps abiertas</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.blue}">
    <div class="label">Avg Deal Size</div>
    <div class="value">${fmt(avgDeal)}</div>
    <div class="sub">por oportunidad</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.green}">
    <div class="label"># Cuentas con Pipeline</div>
    <div class="value">${cuentasPipeline.toLocaleString('es-MX')}</div>
    <div class="sub">cuentas únicas</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.yellow}">
    <div class="label">Por Cerrar (30 días)</div>
    <div class="value">${proxCierreCnt}</div>
    <div class="sub">opps con CloseDate próximo</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.dark}">
    <div class="label">% Win Rate ${year}</div>
    <div class="value">${winRate.toFixed(1)}%</div>
    <div class="sub">${ganadas} ganadas / ${perdidas} perdidas</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.green}">
    <div class="label"># Opp Ganadas ${year}</div>
    <div class="value">${ganadas.toLocaleString('es-MX')}</div>
    <div class="sub">${fmt(ventasYTD)} en revenue</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.red}">
    <div class="label"># Opp Perdidas ${year}</div>
    <div class="value">${perdidas.toLocaleString('es-MX')}</div>
    <div class="sub">${canceladas} canceladas además</div>
  </div>
</div>

<!-- ROW 1: Pipeline funnel + Forecast -->
<div class="chart-row" style="grid-template-columns:1fr 1.5fr">
  <div class="chart-card">
    <h3>Pipeline por Etapa</h3>
    <div class="chart-wrap" style="height:340px"><canvas id="etapaChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Forecast Pipeline (próximos 12 meses por CloseDate)</h3>
    <div class="chart-wrap" style="height:340px"><canvas id="forecastChart"></canvas></div>
  </div>
</div>

<!-- ROW 2: LDN + Estatus_anual + Sem_foro -->
<div class="chart-row" style="grid-template-columns:1fr 1fr 1fr">
  <div class="chart-card">
    <h3>Pipeline por LDN</h3>
    <div class="chart-wrap" style="height:280px"><canvas id="ldnChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Pipeline por Estatus Anual</h3>
    <div class="chart-wrap" style="height:280px"><canvas id="estatusChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Semáforo de Gestión</h3>
    <div class="chart-wrap" style="height:280px"><canvas id="semChart"></canvas></div>
  </div>
</div>

<!-- ROW 3: Esfuerzo comercial + Top motivos pérdida + LeadSource -->
<div class="chart-row" style="grid-template-columns:1.2fr 1fr 1fr">
  <div class="chart-card">
    <h3>Esfuerzo Comercial (Opps creadas/mes)</h3>
    <div class="chart-wrap" style="height:260px"><canvas id="esfChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Top Motivos de Pérdida ${year}</h3>
    <div class="chart-wrap" style="height:260px"><canvas id="motivosChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Pipeline por Canal (LeadSource)</h3>
    <div class="chart-wrap" style="height:260px"><canvas id="canalChart"></canvas></div>
  </div>
</div>

<!-- TABLA: Top 20 oportunidades abiertas -->
<div class="table-card" style="margin-bottom:24px">
  <h3>Top 20 Oportunidades Abiertas</h3>
  <table>
    <thead><tr><th>Oportunidad</th><th>Cuenta</th><th>Etapa</th><th>LDN</th><th>Estatus</th><th>Semáforo</th><th style="text-align:right">Probabilidad</th><th style="text-align:right">Monto</th><th>CloseDate</th><th>Ejecutivo</th></tr></thead>
    <tbody>
    ${detalleTop.map(r => `
      <tr>
        <td><span style="font-weight:500">${r.name.replace(/</g, '&lt;')}</span></td>
        <td>${r.acct.replace(/</g, '&lt;')}</td>
        <td>${r.stage.replace(/</g, '&lt;')}</td>
        <td>${r.ldn}</td>
        <td>${r.estatus}</td>
        <td><span class="tag ${semTagClass(r.sem)}">${r.sem}</span></td>
        <td style="text-align:right">${r.prob}%</td>
        <td style="text-align:right;font-weight:500">${fmtFull(r.amount)}</td>
        <td>${r.close}</td>
        <td>${r.owner}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<!-- ROW Tablas: Top vendedores, Top cuentas -->
<div class="chart-row" style="grid-template-columns:1fr 1fr">
  <div class="table-card">
    <h3>Top 10 Vendedores por Pipeline</h3>
    <table>
      <thead><tr><th>Vendedor</th><th style="text-align:right">$ Pipeline</th><th style="text-align:right"># Opp</th></tr></thead>
      <tbody>${tableRows(topVend)}</tbody>
    </table>
  </div>
  <div class="table-card">
    <h3>Top 10 Cuentas con Pipeline</h3>
    <table>
      <thead><tr><th>Cuenta</th><th style="text-align:right">$ Pipeline</th><th style="text-align:right"># Opp</th></tr></thead>
      <tbody>${tableRows(topCuentas)}</tbody>
    </table>
  </div>
</div>

<script>
const fontDef = {family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11};
const fontSm = {family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:10};
function fmt(n){if(n==null||isNaN(n))return'$0';if(Math.abs(n)>=1e6)return'$'+(n/1e6).toFixed(1)+'M';if(Math.abs(n)>=1e3)return'$'+(n/1e3).toFixed(0)+'K';return'$'+n.toFixed(0)}

// 1. Pipeline por Etapa (funnel-bar horizontal)
new Chart(document.getElementById('etapaChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(etapas.map(e => e.name))},datasets:[{label:'$ Pipeline',data:${JSON.stringify(etapas.map(e => e.total))},backgroundColor:'rgba(255,22,40,0.85)',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.parsed.x)+' | '+${JSON.stringify(etapas.map(e => e.cnt))}[c.dataIndex]+' opps'}}},scales:{x:{ticks:{callback:v=>fmt(v),font:fontDef},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontDef}}}}
});

// 2. Forecast por mes
const fcLabels = ${JSON.stringify(forecastEntries.map(([k]) => k))};
const fcVals = ${JSON.stringify(forecastEntries.map(([, v]) => v))};
new Chart(document.getElementById('forecastChart'),{
  type:'line',
  data:{labels:fcLabels,datasets:[{label:'$ Pipeline por mes',data:fcVals,borderColor:'${COLORS.blue}',backgroundColor:'rgba(59,130,246,0.15)',fill:true,tension:0.4,borderWidth:2.5,pointRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.parsed.y)}}},scales:{y:{ticks:{callback:v=>fmt(v),font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontSm,maxRotation:45,minRotation:45},grid:{display:false}}}}
});

// 3. Pipeline por LDN
new Chart(document.getElementById('ldnChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(ldnData.map(d => d.name))},datasets:[{data:${JSON.stringify(ldnData.map(d => d.total))},backgroundColor:'${COLORS.red}',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.parsed.y)}}},scales:{y:{ticks:{callback:v=>fmt(v),font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef}}}}
});

// 4. Pipeline por Estatus_anual (donut)
new Chart(document.getElementById('estatusChart'),{
  type:'doughnut',
  data:{labels:${JSON.stringify(estatusData.map(d => d.name))},datasets:[{data:${JSON.stringify(estatusData.map(d => d.total))},backgroundColor:['${COLORS.blue}','${COLORS.green}','${COLORS.yellow}','${COLORS.red}']}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:fontSm,boxWidth:10}},tooltip:{callbacks:{label:c=>c.label+': '+fmt(c.parsed)}}}}
});

// 5. Sem_foro (bar con colores)
new Chart(document.getElementById('semChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(semData.map(d => d.name))},datasets:[{data:${JSON.stringify(semData.map(d => d.cnt))},backgroundColor:${JSON.stringify(semData.map(d => semColors[d.name] || COLORS.gray))},borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+' opps | '+fmt(${JSON.stringify(semData.map(d => d.total))}[c.dataIndex])}}},scales:{y:{beginAtZero:true,ticks:{font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef}}}}
});

// 6. Esfuerzo comercial line
new Chart(document.getElementById('esfChart'),{
  type:'line',
  data:{labels:['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],datasets:[
    {label:'${year}',data:${JSON.stringify(esfMonths)},borderColor:'${COLORS.dark}',backgroundColor:'rgba(17,19,28,0.1)',fill:true,tension:0.4,borderWidth:2.5,pointRadius:3},
    {label:'${lastYear}',data:${JSON.stringify(esfMonthsLY)},borderColor:'${COLORS.gray}',borderDash:[5,5],fill:false,tension:0.4,borderWidth:2,pointRadius:2}
  ]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}}},scales:{y:{beginAtZero:true,ticks:{font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef},grid:{display:false}}}}
});

// 7. Motivos de pérdida (bar horizontal)
new Chart(document.getElementById('motivosChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(motivos.map(m => m.name))},datasets:[{data:${JSON.stringify(motivos.map(m => m.cnt))},backgroundColor:'${COLORS.red}',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.x+' opps | '+fmt(${JSON.stringify(motivos.map(m => m.total))}[c.dataIndex])}}},scales:{x:{beginAtZero:true,ticks:{font:fontSm}},y:{ticks:{font:fontSm}}}}
});

// 8. LeadSource (bar)
new Chart(document.getElementById('canalChart'),{
  type:'bar',
  data:{labels:${JSON.stringify(leadSrcData.map(d => d.name))},datasets:[{data:${JSON.stringify(leadSrcData.map(d => d.total))},backgroundColor:'${COLORS.green}',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.parsed.x)}}},scales:{x:{ticks:{callback:v=>fmt(v),font:fontSm}},y:{ticks:{font:fontSm}}}}
});
</script>`;

  return {
    id: 'pipeline',
    title: 'Pipeline y Oportunidades',
    icon: '&#128640;',
    html: dashboardShell(`Pipeline y Oportunidades - ${year}`, date, body),
    generatedAt: now.toISOString(),
    summary: `Pipeline: ${fmt(totalPipeline)} (${totalOpps} opps, ${cuentasPipeline} cuentas) | Win Rate ${winRate.toFixed(0)}% | ${proxCierreCnt} por cerrar 30d`,
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
