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
    query(`SELECT CALENDAR_MONTH(Fecha_de_Emisi_n__c) mes, SUM(Importe_MXN__c) total FROM Invoice__c WHERE Fecha_de_Emisi_n__c = THIS_YEAR AND Estatus_de__c != 'Cancelado' GROUP BY CALENDAR_MONTH(Fecha_de_Emisi_n__c)`),
    query(`SELECT CALENDAR_MONTH(Fecha_de_Emisi_n__c) mes, SUM(Importe_MXN__c) total FROM Invoice__c WHERE Fecha_de_Emisi_n__c = LAST_YEAR AND Estatus_de__c != 'Cancelado' GROUP BY CALENDAR_MONTH(Fecha_de_Emisi_n__c)`),
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
    query(`SELECT Id, Name, Account.Name, Amount, StageName, Probability, CloseDate, Owner.Name, Sem_foro_de_gesti_n__c, Segm_Neg__c, Estatus_anual__c FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' ORDER BY Amount DESC NULLS LAST LIMIT 20`),
    query(`SELECT Owner.Name v, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' AND Amount != null GROUP BY Owner.Name ORDER BY SUM(Amount) DESC NULLS LAST LIMIT 10`),
    query(`SELECT Account.Name a, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName NOT IN ('Ganada!','Perdida','Cancelada') AND CurrencyIsoCode='MXN' AND Amount != null GROUP BY Account.Name ORDER BY SUM(Amount) DESC NULLS LAST LIMIT 10`),
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
    id: r.Id, name: r.Name, acct: r.Account?.Name || '—', amount: r.Amount || 0,
    stage: r.StageName, prob: r.Probability || 0, close: r.CloseDate || '—',
    owner: r.Owner?.Name || '—', sem: r.Sem_foro_de_gesti_n__c || '—',
    ldn: r.Segm_Neg__c || '—', estatus: r.Estatus_anual__c || '—'
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
    // Nuevas queries del PBI Auditoría Comerciales / Control Diario
    tasksStatusYTD,         // # actividades por status (Open/Completed) YTD
    tasksByMonthYTD,        // # actividades creadas por mes YTD (line trend)
    historicoVentasAnio,    // Histórico ventas 4 años (Ganadas/Perdidas/Canceladas)
    auditCuentas,           // Top 15 cuentas: $ venta YTD + # opps
    facturacionEstatus,     // $ Facturación por estatus YTD
  ] = await Promise.all([
    query(`SELECT Type, COUNT(Id) cnt FROM Event WHERE CreatedDate = THIS_YEAR AND Type != null GROUP BY Type ORDER BY COUNT(Id) DESC`),
    query(`SELECT OwnerId, COUNT(Id) cnt FROM Event WHERE CreatedDate = THIS_YEAR AND Type IN ('Reunión Primera visita comercial','Reunión Presentación de propuesta','Reunión de negociación','Reunión de indagación de necesidades','Entrega de Resultados') GROUP BY OwnerId ORDER BY COUNT(Id) DESC LIMIT 15`),
    query(`SELECT OwnerId, COUNT(Id) cnt, SUM(Amount) total FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY OwnerId ORDER BY SUM(Amount) DESC LIMIT 15`),
    query(`SELECT OwnerId, StageName, COUNT(Id) cnt FROM Opportunity WHERE CloseDate = THIS_YEAR AND StageName IN ('Ganada!','Perdida') GROUP BY OwnerId, StageName ORDER BY OwnerId`),
    query(`SELECT TaskSubtype tipo, COUNT(Id) cnt FROM Task WHERE CreatedDate = THIS_MONTH AND TaskSubtype != null GROUP BY TaskSubtype ORDER BY COUNT(Id) DESC LIMIT 10`),
    query(`SELECT CALENDAR_MONTH(CreatedDate) mes, COUNT(Id) cnt FROM Event WHERE CreatedDate = THIS_YEAR AND Type IN ('Reunión Primera visita comercial','Reunión Presentación de propuesta','Reunión de negociación','Reunión de indagación de necesidades') GROUP BY CALENDAR_MONTH(CreatedDate) ORDER BY CALENDAR_MONTH(CreatedDate)`),
    query(`SELECT CALENDAR_MONTH(CloseDate) mes, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName = 'Ganada!' AND CloseDate = THIS_YEAR AND CurrencyIsoCode = 'MXN' GROUP BY CALENDAR_MONTH(CloseDate) ORDER BY CALENDAR_MONTH(CloseDate)`),
    query(`SELECT OwnerId, COUNT(Id) cnt FROM Task WHERE CreatedDate = THIS_MONTH GROUP BY OwnerId ORDER BY COUNT(Id) DESC LIMIT 15`),
    // Nuevas
    query(`SELECT Status s, COUNT(Id) cnt FROM Task WHERE CreatedDate = THIS_YEAR GROUP BY Status`),
    query(`SELECT CALENDAR_MONTH(CreatedDate) mes, COUNT(Id) cnt FROM Task WHERE CreatedDate = THIS_YEAR GROUP BY CALENDAR_MONTH(CreatedDate)`),
    query(`SELECT CALENDAR_YEAR(CloseDate) y, StageName s, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE CurrencyIsoCode='MXN' AND CloseDate >= ${year - 3}-01-01 AND CloseDate <= ${year}-12-31 AND StageName IN ('Ganada!','Perdida','Cancelada') GROUP BY CALENDAR_YEAR(CloseDate), StageName ORDER BY CALENDAR_YEAR(CloseDate)`),
    query(`SELECT Account.Name a, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' AND Amount != null GROUP BY Account.Name ORDER BY SUM(Amount) DESC NULLS LAST LIMIT 15`),
    query(`SELECT Estatus_de__c e, SUM(Importe_MXN__c) total, COUNT(Id) cnt FROM Invoice__c WHERE Fecha_de_Emisi_n__c = THIS_YEAR GROUP BY Estatus_de__c`),
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
  const correlationData = Array.from(new Set([...meetingsMap.keys(), ...salesMap.keys(), ...winRateMap.keys()]))
    .map(ownerId => {
      const name = userNames.get(ownerId) || ownerId;
      const meetings = meetingsMap.get(ownerId) || 0;
      const sales = salesMap.get(ownerId) || { cnt: 0, total: 0 };
      const wr = winRateMap.get(ownerId) || { ganadas: 0, perdidas: 0 };
      const winRate = wr.ganadas + wr.perdidas > 0 ? Math.round((wr.ganadas / (wr.ganadas + wr.perdidas)) * 100) : 0;
      const efficiency = meetings > 0 ? Math.round(sales.total / meetings) : 0; // $ per meeting
      const ratio = sales.cnt > 0 ? +(meetings / sales.cnt).toFixed(1) : 0; // meetings per deal
      return {
        name: name.split(' ').slice(0, 2).join(' '),
        fullName: name,
        meetings,
        deals: sales.cnt,
        revenue: sales.total,
        ganadas: wr.ganadas,
        perdidas: wr.perdidas,
        winRate,
        efficiency,
        ratio,
      };
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

  // Win rate table data with visual bars (solo ejecutivos con cierres reales)
  const winRateTable = correlationData
    .filter(d => d.ganadas + d.perdidas > 0)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 12);

  // ── Nuevos datos del PBI Auditoría/Control Diario ──

  // Actividades YTD por status
  const tasksOpen = (tasksStatusYTD.records || []).find((r: any) => r.s === 'Open')?.cnt || 0;
  const tasksCompleted = (tasksStatusYTD.records || []).find((r: any) => r.s === 'Completed')?.cnt || 0;
  const tasksTotalYTD = tasksOpen + tasksCompleted;
  const tasksCloseRate = tasksTotalYTD > 0 ? (tasksCompleted / tasksTotalYTD) * 100 : 0;

  // Actividades por mes YTD (line trend)
  const tasksMonthly = new Array(12).fill(0);
  (tasksByMonthYTD.records || []).forEach((r: any) => { const m = getMonthVal(r); if (m) tasksMonthly[m - 1] = r.cnt || 0; });

  // Histórico ventas por año (3-4 años)
  const histRecs = (historicoVentasAnio.records || []) as any[];
  const histYears: number[] = Array.from(new Set(histRecs.map((r: any) => r.y).filter((y: any) => y))).sort();
  const histGanada = histYears.map(y => histRecs.find((r: any) => r.y === y && r.s === 'Ganada!')?.total || 0);
  const histPerdida = histYears.map(y => histRecs.find((r: any) => r.y === y && r.s === 'Perdida')?.total || 0);
  const histCancelada = histYears.map(y => histRecs.find((r: any) => r.y === y && r.s === 'Cancelada')?.total || 0);

  // Auditoría top cuentas
  const auditTop = (auditCuentas.records || []).map((r: any) => ({ name: r.a, total: r.total || 0, cnt: r.cnt }));

  // Facturación por estatus
  const factEst = (facturacionEstatus.records || []).map((r: any) => ({ name: r.e, total: r.total || 0, cnt: r.cnt }));
  const factTotal = factEst.reduce((s: number, f: any) => s + f.total, 0);
  const factPagada = factEst.find((f: any) => f.name === 'Pagado')?.total || 0;
  const factPendiente = factEst.filter((f: any) => f.name !== 'Pagado' && f.name !== 'Cancelado').reduce((s: number, f: any) => s + f.total, 0);

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
    <div class="label">Actividades YTD</div>
    <div class="value">${tasksTotalYTD.toLocaleString('es-MX')}</div>
    <div class="sub">${tasksCloseRate.toFixed(0)}% completadas</div>
  </div>
  <div class="kpi">
    <div class="label">$ Facturación Emitida YTD</div>
    <div class="value">${fmt(factTotal)}</div>
    <div class="sub" style="color:${COLORS.green}">${fmt(factPagada)} pagadas</div>
  </div>
  <div class="kpi">
    <div class="label">$ Cobranza Pendiente</div>
    <div class="value" style="color:${COLORS.yellow}">${fmt(factPendiente)}</div>
    <div class="sub">Por cobrar</div>
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
      <td style="color:${COLORS.green}">${d.ganadas}</td>
      <td style="color:${COLORS.red}">${d.perdidas}</td>
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

<!-- AUDITORÍA: Histórico ventas + Actividades YTD + Tabla cuentas -->
<div class="chart-row" style="grid-template-columns:1.3fr 1fr">
  <div class="chart-card">
    <h3>Histórico de Ventas (últimos ${histYears.length} años)</h3>
    <p style="font-size:11px;color:#6b7280;margin-bottom:12px">Comparativo de oportunidades cerradas por año (Ganadas / Perdidas / Canceladas).</p>
    <div class="chart-wrap" style="height:300px"><canvas id="historicoChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Actividades Creadas por Mes (${year})</h3>
    <p style="font-size:11px;color:#6b7280;margin-bottom:12px">Tareas + emails + llamadas creadas mensualmente. ${tasksOpen.toLocaleString('es-MX')} abiertas, ${tasksCompleted.toLocaleString('es-MX')} completadas.</p>
    <div class="chart-wrap" style="height:300px"><canvas id="tasksMonthlyChart"></canvas></div>
  </div>
</div>

<div class="table-card">
  <h3>Auditoría: Top 15 Cuentas por Venta ${year}</h3>
  <table>
    <thead><tr><th>Cuenta</th><th style="text-align:right">$ Venta YTD</th><th style="text-align:right"># Opp Ganadas</th><th style="text-align:right">% del total</th></tr></thead>
    <tbody>
      ${(() => {
        const totalAudit = auditTop.reduce((s, a) => s + a.total, 0);
        return auditTop.map(a => `
        <tr>
          <td>${(a.name || '—').toString().replace(/</g, '&lt;')}</td>
          <td style="text-align:right;font-weight:500">${fmtFull(a.total)}</td>
          <td style="text-align:right;color:#6B7280">${a.cnt}</td>
          <td style="text-align:right">${totalAudit > 0 ? ((a.total / totalAudit) * 100).toFixed(1) : 0}%</td>
        </tr>`).join('');
      })()}
    </tbody>
  </table>
</div>

<script>
// Charts auditoría
const histYears = ${JSON.stringify(histYears)};
const histGanada = ${JSON.stringify(histGanada)};
const histPerdida = ${JSON.stringify(histPerdida)};
const histCancelada = ${JSON.stringify(histCancelada)};
const tasksMonthly = ${JSON.stringify(tasksMonthly)};

new Chart(document.getElementById('historicoChart'),{
  type:'bar',
  data:{labels:histYears,datasets:[
    {label:'Ganadas',data:histGanada,backgroundColor:'${COLORS.green}',borderRadius:4},
    {label:'Perdidas',data:histPerdida,backgroundColor:'${COLORS.red}',borderRadius:4},
    {label:'Canceladas',data:histCancelada,backgroundColor:'${COLORS.gray}',borderRadius:4}
  ]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11},boxWidth:10}},tooltip:{callbacks:{label:c=>c.dataset.label+': $'+(c.parsed.y/1e6).toFixed(2)+'M'}}},scales:{y:{stacked:false,ticks:{callback:v=>'$'+(v/1e6).toFixed(0)+'M',font:{family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11}},grid:{color:'#f0f0f0'}},x:{ticks:{font:{family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11}},grid:{display:false}}}}
});

new Chart(document.getElementById('tasksMonthlyChart'),{
  type:'line',
  data:{labels:['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],datasets:[{label:'# Actividades creadas',data:tasksMonthly,borderColor:'${COLORS.blue}',backgroundColor:'rgba(59,130,246,0.15)',fill:true,tension:0.4,borderWidth:2.5,pointRadius:3}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{font:{family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11}},grid:{color:'#f0f0f0'}},x:{ticks:{font:{family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11}},grid:{display:false}}}}
});
</script>

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

// ─── Report 5: Metas vs Real (réplica de "Metas/Crecimiento" del PBI) ───────

const MES_NUM: Record<string, number> = {
  'Enero': 1, 'Febrero': 2, 'Marzo': 3, 'Abril': 4, 'Mayo': 5, 'Junio': 6,
  'Julio': 7, 'Agosto': 8, 'Septiembre': 9, 'Octubre': 10, 'Noviembre': 11, 'Diciembre': 12,
};

async function generateMetas(query: QueryFn): Promise<ReportCache> {
  const now = new Date();
  const year = now.getFullYear();
  const lastYear = year - 1;
  const currentMonth = now.getMonth() + 1; // 1-12

  const [
    metasPorMes,            // Metas mensuales del año actual
    metasPorEjec,           // Metas anuales por ejecutivo
    metasPorLDN,            // Metas por LDN sumadas
    ventasMes,              // Ventas YTD por mes
    ventasMesLY,            // Ventas LY por mes
    ventasEjec,             // Ventas YTD por ejecutivo
    ventasEjecLY,           // Ventas LY por ejecutivo
    ventasLDN,              // Ventas YTD por LDN
    cuentasNuevas,          // Ventas a cuentas nuevas YTD
    cuentasNuevasLY,        // Ventas a cuentas nuevas LY
    ticketProm,             // Ticket promedio YTD
    ticketPromLY,           // Ticket promedio LY
    facturacionMes,         // Facturación emitida YTD por mes
  ] = await Promise.all([
    query(`SELECT Mes__c, SUM(Meta_Mensual__c), SUM(LDN1_meta_total__c), SUM(LDN2_meta_total__c), SUM(LDN_3_Meta_total__c), SUM(LDN_4_Meta_total__c) FROM Meta_de_venta__c WHERE A_o__c = ${year} GROUP BY Mes__c`),
    query(`SELECT Ejecutivo_de_venta__c, Mes__c, SUM(Meta_Mensual__c) FROM Meta_de_venta__c WHERE A_o__c = ${year} AND Ejecutivo_de_venta__c != null GROUP BY Ejecutivo_de_venta__c, Mes__c`),
    query(`SELECT SUM(LDN1_meta_total__c), SUM(LDN2_meta_total__c), SUM(LDN_3_Meta_total__c), SUM(LDN_4_Meta_total__c) FROM Meta_de_venta__c WHERE A_o__c = ${year}`),
    query(`SELECT CALENDAR_MONTH(CloseDate) mes, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' GROUP BY CALENDAR_MONTH(CloseDate) ORDER BY CALENDAR_MONTH(CloseDate)`),
    query(`SELECT CALENDAR_MONTH(CloseDate) mes, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=LAST_YEAR AND CurrencyIsoCode='MXN' GROUP BY CALENDAR_MONTH(CloseDate) ORDER BY CALENDAR_MONTH(CloseDate)`),
    query(`SELECT OwnerId, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' AND Amount != null GROUP BY OwnerId ORDER BY SUM(Amount) DESC NULLS LAST LIMIT 25`),
    query(`SELECT OwnerId, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=LAST_YEAR AND CurrencyIsoCode='MXN' AND Amount != null GROUP BY OwnerId`),
    query(`SELECT Segm_Neg__c ldn, SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' AND Segm_Neg__c != null GROUP BY Segm_Neg__c ORDER BY SUM(Amount) DESC`),
    query(`SELECT SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' AND Estatus_anual__c='Nuevo'`),
    query(`SELECT SUM(Amount) total, COUNT(Id) cnt FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=LAST_YEAR AND CurrencyIsoCode='MXN' AND Estatus_anual__c='Nuevo'`),
    query(`SELECT AVG(Amount) avg FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN'`),
    query(`SELECT AVG(Amount) avg FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=LAST_YEAR AND CurrencyIsoCode='MXN'`),
    query(`SELECT CALENDAR_MONTH(Fecha_de_Emisi_n__c) mes, SUM(Importe_MXN__c) total FROM Invoice__c WHERE Fecha_de_Emisi_n__c=THIS_YEAR AND Estatus_de__c != 'Cancelado' GROUP BY CALENDAR_MONTH(Fecha_de_Emisi_n__c)`),
  ]);

  // Helper: extraer valores agregados de SF (que vienen como expr0, expr1, etc.)
  function getExpr(rec: any, idx: number): number {
    return Number(rec[`expr${idx}`]) || 0;
  }
  function getMonthVal(rec: any): number | null {
    for (const k of Object.keys(rec)) {
      if (k === 'attributes' || k === 'total' || k === 'cnt' || k === 'avg') continue;
      const v = Number(rec[k]); if (!isNaN(v) && v >= 1 && v <= 12) return v;
    }
    return null;
  }

  // ── Procesar metas mensuales: array de 12 con metaTotal y por LDN ──
  const metaMensual = new Array(12).fill(0);
  const metaLDN1 = new Array(12).fill(0);
  const metaLDN2 = new Array(12).fill(0);
  const metaLDN3 = new Array(12).fill(0);
  const metaLDN4 = new Array(12).fill(0);
  (metasPorMes.records || []).forEach((r: any) => {
    const mNum = MES_NUM[r.Mes__c] || 0;
    if (mNum >= 1 && mNum <= 12) {
      const idx = mNum - 1;
      metaMensual[idx] = getExpr(r, 0);
      metaLDN1[idx] = getExpr(r, 1);
      metaLDN2[idx] = getExpr(r, 2);
      metaLDN3[idx] = getExpr(r, 3);
      metaLDN4[idx] = getExpr(r, 4);
    }
  });
  const metaAnual = metaMensual.reduce((a, b) => a + b, 0);
  const metaYTD = metaMensual.slice(0, currentMonth).reduce((a, b) => a + b, 0);

  // ── Ventas mensuales (este año + LY) ──
  const ventaMes = new Array(12).fill(0);
  const ventaMesLY = new Array(12).fill(0);
  (ventasMes.records || []).forEach((r: any) => { const m = getMonthVal(r); if (m) ventaMes[m - 1] = r.total || 0; });
  (ventasMesLY.records || []).forEach((r: any) => { const m = getMonthVal(r); if (m) ventaMesLY[m - 1] = r.total || 0; });
  const ventaYTD = ventaMes.reduce((a, b) => a + b, 0);
  const ventaYTDLY = ventaMesLY.slice(0, currentMonth).reduce((a, b) => a + b, 0);

  const factMes = new Array(12).fill(0);
  (facturacionMes.records || []).forEach((r: any) => { const m = getMonthVal(r); if (m) factMes[m - 1] = r.total || 0; });
  const factYTD = factMes.reduce((a, b) => a + b, 0);

  // ── KPIs principales ──
  const alcanceYTD = metaYTD > 0 ? (ventaYTD / metaYTD) * 100 : 0;
  const alcanceAnual = metaAnual > 0 ? (ventaYTD / metaAnual) * 100 : 0;
  const faltanteYTD = metaYTD - ventaYTD;
  const ticketAvg = ticketProm.records?.[0]?.avg || 0;
  const ticketAvgLY = ticketPromLY.records?.[0]?.avg || 0;
  const cuentasNuevasTotal = cuentasNuevas.records?.[0]?.total || 0;
  const cuentasNuevasCnt = cuentasNuevas.records?.[0]?.cnt || 0;
  const cuentasNuevasTotalLY = cuentasNuevasLY.records?.[0]?.total || 0;
  const pctVarVentaLY = ventaYTDLY > 0 ? ((ventaYTD - ventaYTDLY) / ventaYTDLY) * 100 : 0;
  const pctVarTicketLY = ticketAvgLY > 0 ? ((ticketAvg - ticketAvgLY) / ticketAvgLY) * 100 : 0;
  const pctCuentasNuevas = ventaYTD > 0 ? (cuentasNuevasTotal / ventaYTD) * 100 : 0;

  // ── User name lookup ──
  const userIds = new Set<string>();
  (metasPorEjec.records || []).forEach((r: any) => userIds.add(r.Ejecutivo_de_venta__c));
  (ventasEjec.records || []).forEach((r: any) => userIds.add(r.OwnerId));
  (ventasEjecLY.records || []).forEach((r: any) => userIds.add(r.OwnerId));
  const userNames = new Map<string, string>();
  try {
    const allUsers = await query(`SELECT Id, Name FROM User WHERE IsActive = true LIMIT 200`);
    (allUsers.records || []).forEach((u: any) => userNames.set(u.Id, u.Name));
  } catch (e: any) {
    process.stderr.write(`[reports] User query failed: ${e.message}\n`);
  }

  // ── Ranking ejecutivos: Meta vs Venta vs Var LY ──
  // Calcular dos metas por ejecutivo: anual completa + YTD (solo meses transcurridos)
  const metaByEjec = new Map<string, number>();        // meta anual
  const metaByEjecYTD = new Map<string, number>();     // meta YTD (solo meses ya pasados)
  (metasPorEjec.records || []).forEach((r: any) => {
    const ejecId = r.Ejecutivo_de_venta__c;
    const metaMonth = getExpr(r, 0);
    const monthNum = MES_NUM[r.Mes__c] || 0;
    metaByEjec.set(ejecId, (metaByEjec.get(ejecId) || 0) + metaMonth);
    if (monthNum >= 1 && monthNum <= currentMonth) {
      metaByEjecYTD.set(ejecId, (metaByEjecYTD.get(ejecId) || 0) + metaMonth);
    }
  });
  const ventaByEjec = new Map<string, number>();
  const ventaCntByEjec = new Map<string, number>();
  (ventasEjec.records || []).forEach((r: any) => {
    ventaByEjec.set(r.OwnerId, r.total || 0);
    ventaCntByEjec.set(r.OwnerId, r.cnt || 0);
  });
  const ventaByEjecLY = new Map<string, number>();
  (ventasEjecLY.records || []).forEach((r: any) => ventaByEjecLY.set(r.OwnerId, r.total || 0));

  const allEjecIds = Array.from(new Set([...metaByEjec.keys(), ...ventaByEjec.keys()]));
  const ranking = allEjecIds.map(id => {
    const name = userNames.get(id) || 'Sin nombre';
    const metaAnualEjec = metaByEjec.get(id) || 0;
    const metaYTDEjec = metaByEjecYTD.get(id) || 0;
    const ventaTot = ventaByEjec.get(id) || 0;
    const ventaTotLY = ventaByEjecLY.get(id) || 0;
    const cnt = ventaCntByEjec.get(id) || 0;
    const alcance = metaYTDEjec > 0 ? (ventaTot / metaYTDEjec) * 100 : 0; // % alcance vs meta YTD prorrateada
    const varLY = ventaTotLY > 0 ? ((ventaTot - ventaTotLY) / ventaTotLY) * 100 : (ventaTot > 0 ? 100 : 0);
    const faltante = Math.max(0, metaYTDEjec - ventaTot);
    return { id, name, meta: metaAnualEjec, metaYTD: metaYTDEjec, venta: ventaTot, ventaLY: ventaTotLY, cnt, alcance, varLY, faltante };
  })
    .filter(r => r.meta > 0 || r.venta > 0)
    .sort((a, b) => b.alcance - a.alcance);

  // ── Por LDN: meta vs venta ──
  const metaLDNTotals = (metasPorLDN.records || [])[0] || {};
  const ventaLDNMap = new Map<string, number>();
  (ventasLDN.records || []).forEach((r: any) => ventaLDNMap.set(r.ldn, r.total || 0));
  const ldnRanking = [
    { name: 'LDN 1', meta: getExpr(metaLDNTotals, 0), venta: ventaLDNMap.get('LDN 1') || 0 },
    { name: 'LDN 2', meta: getExpr(metaLDNTotals, 1), venta: ventaLDNMap.get('LDN 2') || 0 },
    { name: 'LDN 3', meta: getExpr(metaLDNTotals, 2), venta: ventaLDNMap.get('LDN 3') || 0 },
    { name: 'LDN 4', meta: getExpr(metaLDNTotals, 3), venta: ventaLDNMap.get('LDN 4') || 0 },
  ].map(l => ({ ...l, alcance: l.meta > 0 ? (l.venta / l.meta) * 100 : 0 }));

  // Sortear ranking por venta también (para chart de top vendedores)
  const topVenta = [...ranking].sort((a, b) => b.venta - a.venta).slice(0, 12);

  const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const semaforoAlcance = (pct: number) => pct >= 100 ? COLORS.green : pct >= 80 ? COLORS.yellow : pct >= 50 ? '#F97316' : COLORS.red;
  const tagAlcance = (pct: number) => pct >= 100 ? 'tag-green' : pct >= 80 ? 'tag-yellow' : 'tag-red';

  const body = `
<!-- KPIs -->
<div class="kpi-row">
  <div class="kpi" style="border-top:3px solid ${semaforoAlcance(alcanceYTD)}">
    <div class="label">% Alcance YTD</div>
    <div class="value" style="color:${semaforoAlcance(alcanceYTD)}">${alcanceYTD.toFixed(1)}%</div>
    <div class="sub">${fmt(ventaYTD)} / ${fmt(metaYTD)}</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.red}">
    <div class="label">$ Venta YTD</div>
    <div class="value">${fmtFull(ventaYTD)}</div>
    <div class="sub" style="color:${pctVarVentaLY >= 0 ? COLORS.green : COLORS.red}">${pctVarVentaLY >= 0 ? '+' : ''}${pctVarVentaLY.toFixed(1)}% vs ${lastYear}</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.blue}">
    <div class="label">$ Meta Anual ${year}</div>
    <div class="value">${fmt(metaAnual)}</div>
    <div class="sub">${alcanceAnual.toFixed(1)}% del anual logrado</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.yellow}">
    <div class="label">$ Faltante para Meta YTD</div>
    <div class="value" style="color:${faltanteYTD > 0 ? COLORS.red : COLORS.green}">${faltanteYTD > 0 ? fmt(faltanteYTD) : '✓ Cumplida'}</div>
    <div class="sub">${currentMonth} de 12 meses</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.green}">
    <div class="label">$ Ticket Promedio</div>
    <div class="value">${fmt(ticketAvg)}</div>
    <div class="sub" style="color:${pctVarTicketLY >= 0 ? COLORS.green : COLORS.red}">${pctVarTicketLY >= 0 ? '+' : ''}${pctVarTicketLY.toFixed(1)}% vs ${lastYear}</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.dark}">
    <div class="label">$ Cuentas Nuevas YTD</div>
    <div class="value">${fmt(cuentasNuevasTotal)}</div>
    <div class="sub">${cuentasNuevasCnt} opps · ${pctCuentasNuevas.toFixed(0)}% del total</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.gray}">
    <div class="label">$ Facturación Emitida YTD</div>
    <div class="value">${fmt(factYTD)}</div>
    <div class="sub">vs venta cerrada</div>
  </div>
</div>

<!-- ROW 1: Meta vs Venta mensual (column) + Acumulado (line) -->
<div class="chart-row" style="grid-template-columns:1fr 1fr">
  <div class="chart-card">
    <h3>Meta vs Venta Mensual ${year}</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="metaMesChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Acumulado: Meta vs Venta vs LY</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="acumChart"></canvas></div>
  </div>
</div>

<!-- ROW 2: Alcance por Vendedor + Crecimiento por Vendedor -->
<div class="chart-row" style="grid-template-columns:1fr 1fr">
  <div class="chart-card">
    <h3>% Alcance por Vendedor</h3>
    <div class="chart-wrap" style="height:380px"><canvas id="alcanceChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>% Crecimiento por Vendedor (vs ${lastYear})</h3>
    <div class="chart-wrap" style="height:380px"><canvas id="crecimientoChart"></canvas></div>
  </div>
</div>

<!-- ROW 3: Por LDN -->
<div class="chart-row">
  <div class="chart-card" style="grid-column:1/-1">
    <h3>Meta vs Venta por LDN</h3>
    <div class="chart-wrap" style="height:280px"><canvas id="ldnMetaChart"></canvas></div>
  </div>
</div>

<!-- TABLA: Ranking ejecutivos -->
<div class="table-card" style="margin-bottom:24px">
  <h3>Ranking de Ejecutivos: Meta vs Real ${year}</h3>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Ejecutivo</th>
        <th style="text-align:right">$ Meta YTD</th>
        <th style="text-align:right">$ Meta Anual</th>
        <th style="text-align:right">$ Venta YTD</th>
        <th style="text-align:right"># Opp</th>
        <th style="text-align:right">% Alcance YTD</th>
        <th style="text-align:right">$ Faltante</th>
        <th style="text-align:right">% vs ${lastYear}</th>
      </tr>
    </thead>
    <tbody>
      ${ranking.slice(0, 20).map((r, i) => `
      <tr>
        <td><strong>${i + 1}</strong></td>
        <td>${r.name.replace(/</g, '&lt;')}</td>
        <td style="text-align:right">${fmtFull(r.metaYTD)}</td>
        <td style="text-align:right;color:#6B7280">${fmtFull(r.meta)}</td>
        <td style="text-align:right;font-weight:500">${fmtFull(r.venta)}</td>
        <td style="text-align:right;color:#6B7280">${r.cnt}</td>
        <td style="text-align:right"><span class="tag ${tagAlcance(r.alcance)}">${r.alcance.toFixed(0)}%</span></td>
        <td style="text-align:right;color:${r.faltante > 0 ? COLORS.red : COLORS.green}">${r.faltante > 0 ? fmt(r.faltante) : '—'}</td>
        <td style="text-align:right;color:${r.varLY >= 0 ? COLORS.green : COLORS.red}">${r.varLY >= 0 ? '+' : ''}${r.varLY.toFixed(0)}%</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<!-- TABLA: Por LDN -->
<div class="table-card">
  <h3>Por Línea de Negocio (LDN)</h3>
  <table>
    <thead><tr><th>LDN</th><th style="text-align:right">$ Meta</th><th style="text-align:right">$ Venta</th><th style="text-align:right">% Alcance</th></tr></thead>
    <tbody>
      ${ldnRanking.map(l => `
      <tr>
        <td><strong>${l.name}</strong></td>
        <td style="text-align:right">${fmtFull(l.meta)}</td>
        <td style="text-align:right;font-weight:500">${fmtFull(l.venta)}</td>
        <td style="text-align:right"><span class="tag ${tagAlcance(l.alcance)}">${l.alcance.toFixed(0)}%</span></td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<script>
const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const fontDef = {family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11};
const fontSm = {family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:10};
function fmt(n){if(n==null||isNaN(n))return'$0';if(Math.abs(n)>=1e6)return'$'+(n/1e6).toFixed(1)+'M';if(Math.abs(n)>=1e3)return'$'+(n/1e3).toFixed(0)+'K';return'$'+n.toFixed(0)}

// 1. Meta vs Venta mensual
new Chart(document.getElementById('metaMesChart'),{
  type:'bar',
  data:{labels:meses,datasets:[
    {label:'Meta',data:${JSON.stringify(metaMensual)},backgroundColor:'rgba(59,130,246,0.5)',borderRadius:4},
    {label:'Venta',data:${JSON.stringify(ventaMes)},backgroundColor:'rgba(255,22,40,0.85)',borderRadius:4}
  ]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+fmt(c.parsed.y)}}},scales:{y:{ticks:{callback:v=>fmt(v),font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef},grid:{display:false}}}}
});

// 2. Acumulado
const metaAcum = ${JSON.stringify(metaMensual)}.reduce((acc,v,i)=>{acc.push((acc[i-1]||0)+v);return acc},[]);
const ventaAcum = ${JSON.stringify(ventaMes)}.reduce((acc,v,i)=>{acc.push((acc[i-1]||0)+v);return acc},[]);
const ventaAcumLY = ${JSON.stringify(ventaMesLY)}.reduce((acc,v,i)=>{acc.push((acc[i-1]||0)+v);return acc},[]);
new Chart(document.getElementById('acumChart'),{
  type:'line',
  data:{labels:meses,datasets:[
    {label:'Meta acum',data:metaAcum,borderColor:'${COLORS.blue}',borderDash:[5,5],fill:false,tension:0.4,borderWidth:2,pointRadius:3},
    {label:'Venta acum '+${year},data:ventaAcum,borderColor:'${COLORS.red}',backgroundColor:'rgba(255,22,40,0.08)',fill:true,tension:0.4,borderWidth:2.5,pointRadius:4},
    {label:'Venta acum ${lastYear}',data:ventaAcumLY,borderColor:'${COLORS.gray}',borderDash:[3,3],fill:false,tension:0.4,borderWidth:2,pointRadius:2}
  ]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+fmt(c.parsed.y)}}},scales:{y:{ticks:{callback:v=>fmt(v),font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef},grid:{display:false}}}}
});

// 3. Alcance por Vendedor (bar horizontal con color por threshold)
const alcanceData = ${JSON.stringify(ranking.slice(0, 15))};
const alcColors = alcanceData.map(d=>d.alcance>=100?'${COLORS.green}':d.alcance>=80?'${COLORS.yellow}':d.alcance>=50?'#F97316':'${COLORS.red}');
new Chart(document.getElementById('alcanceChart'),{
  type:'bar',
  data:{labels:alcanceData.map(d=>d.name.split(' ').slice(0,2).join(' ')),datasets:[{data:alcanceData.map(d=>d.alcance),backgroundColor:alcColors,borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.x.toFixed(1)+'% | Meta YTD: '+fmt(alcanceData[c.dataIndex].metaYTD)+' · Venta: '+fmt(alcanceData[c.dataIndex].venta)}}},scales:{x:{ticks:{callback:v=>v+'%',font:fontSm},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontSm},grid:{display:false}}}}
});

// 4. Crecimiento por vendedor (% vs LY)
const topVenta = ${JSON.stringify(topVenta)};
const crecData = topVenta.filter(d => d.ventaLY > 0);
new Chart(document.getElementById('crecimientoChart'),{
  type:'bar',
  data:{labels:crecData.map(d=>d.name.split(' ').slice(0,2).join(' ')),datasets:[{data:crecData.map(d=>d.varLY),backgroundColor:crecData.map(d=>d.varLY>=0?'${COLORS.green}':'${COLORS.red}'),borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.x.toFixed(1)+'% | Venta: '+fmt(crecData[c.dataIndex].venta)+' · LY: '+fmt(crecData[c.dataIndex].ventaLY)}}},scales:{x:{ticks:{callback:v=>v+'%',font:fontSm},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontSm},grid:{display:false}}}}
});

// 5. Por LDN
const ldnData = ${JSON.stringify(ldnRanking)};
new Chart(document.getElementById('ldnMetaChart'),{
  type:'bar',
  data:{labels:ldnData.map(d=>d.name),datasets:[
    {label:'Meta',data:ldnData.map(d=>d.meta),backgroundColor:'rgba(59,130,246,0.5)',borderRadius:4},
    {label:'Venta',data:ldnData.map(d=>d.venta),backgroundColor:'rgba(255,22,40,0.85)',borderRadius:4}
  ]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+fmt(c.parsed.y)+(c.dataset.label==='Venta'?' ('+ldnData[c.dataIndex].alcance.toFixed(0)+'% alcance)':'')}}},scales:{y:{ticks:{callback:v=>fmt(v),font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef}}}}
});
</script>`;

  return {
    id: 'metas',
    title: 'Metas y Ranking',
    icon: '&#127942;',
    html: dashboardShell(`Metas y Ranking - ${year}`, date, body),
    generatedAt: now.toISOString(),
    summary: `Alcance YTD: ${alcanceYTD.toFixed(0)}% (${fmt(ventaYTD)} de ${fmt(metaYTD)}) | Meta anual: ${fmt(metaAnual)} | ${pctVarVentaLY.toFixed(0)}% vs ${lastYear}`,
  };
}

// ─── Report 6: Cobranza (réplica de "Facturación" del PBI) ──────────────────

async function generateCobranza(query: QueryFn): Promise<ReportCache> {
  const now = new Date();
  const year = now.getFullYear();
  const lastYear = year - 1;

  const [
    estatusYTD,           // $ por estatus YTD
    estatusLY,            // $ por estatus LY
    porMesYTD,            // Facturado y cobrado por mes YTD
    politicaPagoYTD,      // Por política de pago (pendiente)
    facturacionAntigua,   // Facturación antigua aún pendiente
    topPendientes,        // Top 15 facturas pendientes
    topCuentasSaldo,      // Top cuentas con mayor saldo pendiente
    porUsoCFDI,           // Por uso de CFDI
    porCondiciones,       // Crédito vs Contado
  ] = await Promise.all([
    query(`SELECT Estatus_de__c e, SUM(Importe_MXN__c) total, COUNT(Id) cnt FROM Invoice__c WHERE Fecha_de_Emisi_n__c=THIS_YEAR AND Importe_MXN__c > 0 GROUP BY Estatus_de__c ORDER BY SUM(Importe_MXN__c) DESC`),
    query(`SELECT Estatus_de__c e, SUM(Importe_MXN__c) total, COUNT(Id) cnt FROM Invoice__c WHERE Fecha_de_Emisi_n__c=LAST_YEAR AND Importe_MXN__c > 0 GROUP BY Estatus_de__c`),
    query(`SELECT CALENDAR_MONTH(Fecha_de_Emisi_n__c) mes, Estatus_de__c e, SUM(Importe_MXN__c) total, COUNT(Id) cnt FROM Invoice__c WHERE Fecha_de_Emisi_n__c=THIS_YEAR AND Importe_MXN__c > 0 GROUP BY CALENDAR_MONTH(Fecha_de_Emisi_n__c), Estatus_de__c`),
    query(`SELECT Pol_tica_de_Pago__c p, SUM(Importe_MXN__c) total, COUNT(Id) cnt FROM Invoice__c WHERE Estatus_de__c IN ('Emitido','En Proceso de Pago') AND Importe_MXN__c > 0 AND Pol_tica_de_Pago__c != null GROUP BY Pol_tica_de_Pago__c ORDER BY SUM(Importe_MXN__c) DESC`),
    query(`SELECT SUM(Importe_MXN__c) total, COUNT(Id) cnt FROM Invoice__c WHERE Fecha_de_Emisi_n__c < ${year}-01-01 AND Estatus_de__c IN ('Emitido','En Proceso de Pago') AND Importe_MXN__c > 0`),
    query(`SELECT Id, Name, Raz_n_Social__c, Importe_MXN__c, Estatus_de__c, Fecha_de_Emisi_n__c, Pol_tica_de_Pago__c, Fecha_de_Pago__c FROM Invoice__c WHERE Estatus_de__c IN ('Emitido','En Proceso de Pago') AND Importe_MXN__c > 0 ORDER BY Importe_MXN__c DESC NULLS LAST LIMIT 20`),
    query(`SELECT Raz_n_Social__c a, SUM(Importe_MXN__c) total, COUNT(Id) cnt FROM Invoice__c WHERE Estatus_de__c IN ('Emitido','En Proceso de Pago') AND Importe_MXN__c > 0 AND Raz_n_Social__c != null GROUP BY Raz_n_Social__c ORDER BY SUM(Importe_MXN__c) DESC NULLS LAST LIMIT 10`),
    query(`SELECT CFDI__c u, SUM(Importe_MXN__c) total, COUNT(Id) cnt FROM Invoice__c WHERE Fecha_de_Emisi_n__c=THIS_YEAR AND Importe_MXN__c > 0 AND CFDI__c != null GROUP BY CFDI__c ORDER BY SUM(Importe_MXN__c) DESC`),
    query(`SELECT Condiciones_de_Pago__c c, SUM(Importe_MXN__c) total, COUNT(Id) cnt FROM Invoice__c WHERE Fecha_de_Emisi_n__c=THIS_YEAR AND Importe_MXN__c > 0 AND Condiciones_de_Pago__c != null GROUP BY Condiciones_de_Pago__c`),
  ]);

  function getMonthVal(rec: any): number | null {
    for (const k of Object.keys(rec)) {
      if (k === 'attributes' || k === 'total' || k === 'cnt' || k === 'e') continue;
      const v = Number(rec[k]); if (!isNaN(v) && v >= 1 && v <= 12) return v;
    }
    return null;
  }

  // ── Estatus YTD ──
  const estData = (estatusYTD.records || []).map((r: any) => ({ name: r.e, total: r.total || 0, cnt: r.cnt }));
  const facturadoYTD = estData.reduce((s: number, e: any) => s + e.total, 0);
  const pagadoYTD = estData.find((e: any) => e.name === 'Pagado')?.total || 0;
  const enProceso = estData.find((e: any) => e.name === 'En Proceso de Pago')?.total || 0;
  const emitido = estData.find((e: any) => e.name === 'Emitido')?.total || 0;
  const cancelado = estData.find((e: any) => e.name === 'Cancelado')?.total || 0;
  const pendienteYTD = enProceso + emitido;
  const pctCobrado = facturadoYTD > 0 ? (pagadoYTD / facturadoYTD) * 100 : 0;

  // Comparativo LY
  const facturadoLY = (estatusLY.records || []).reduce((s: number, r: any) => s + (r.total || 0), 0);
  const pagadoLYRecs = (estatusLY.records || []) as any[];
  const pagadoLY = pagadoLYRecs.find((r: any) => r.e === 'Pagado')?.total || 0;
  const pctVarFact = facturadoLY > 0 ? ((facturadoYTD - facturadoLY) / facturadoLY) * 100 : 0;
  const pctVarCobro = pagadoLY > 0 ? ((pagadoYTD - pagadoLY) / pagadoLY) * 100 : 0;

  // Facturación antigua
  const factAntigua = facturacionAntigua.records?.[0]?.total || 0;
  const factAntiguaCnt = facturacionAntigua.records?.[0]?.cnt || 0;

  // ── Por mes (split por estatus) ──
  const factEmitidoMes = new Array(12).fill(0);
  const factPagadoMes = new Array(12).fill(0);
  const factCanceladoMes = new Array(12).fill(0);
  (porMesYTD.records || []).forEach((r: any) => {
    const m = getMonthVal(r);
    if (!m) return;
    const total = r.total || 0;
    if (r.e === 'Pagado') factPagadoMes[m - 1] += total;
    else if (r.e === 'Cancelado') factCanceladoMes[m - 1] += total;
    else factEmitidoMes[m - 1] += total;
  });
  const factTotalMes = factEmitidoMes.map((v, i) => v + factPagadoMes[i]);

  // ── Política de pago ──
  const politicas = (politicaPagoYTD.records || []).map((r: any) => ({ name: r.p, total: r.total || 0, cnt: r.cnt }));

  // ── Uso CFDI ──
  const usoCFDI = (porUsoCFDI.records || []).map((r: any) => ({ name: r.u, total: r.total || 0, cnt: r.cnt }));

  // ── Condiciones ──
  const condiciones = (porCondiciones.records || []).map((r: any) => ({ name: r.c, total: r.total || 0, cnt: r.cnt }));

  // ── Top pendientes con cálculo de antigüedad (días) ──
  const today = now.getTime();
  const topPend = (topPendientes.records || []).map((r: any) => {
    const emisionDate = r.Fecha_de_Emisi_n__c ? new Date(r.Fecha_de_Emisi_n__c).getTime() : 0;
    const dias = emisionDate ? Math.floor((today - emisionDate) / 86400000) : 0;
    return {
      id: r.Id,
      name: r.Name,
      acct: r.Raz_n_Social__c || '—',
      total: r.Importe_MXN__c || 0,
      estatus: r.Estatus_de__c,
      emision: r.Fecha_de_Emisi_n__c || '—',
      politica: r.Pol_tica_de_Pago__c || '—',
      pago: r.Fecha_de_Pago__c || '—',
      dias,
    };
  });

  // ── Top cuentas con saldo ──
  const topAcc = (topCuentasSaldo.records || []).map((r: any) => ({ name: r.a || '—', total: r.total || 0, cnt: r.cnt }));

  // ── Antigüedad de saldos (buckets) ──
  const buckets = { '0-30': { total: 0, cnt: 0 }, '31-60': { total: 0, cnt: 0 }, '61-90': { total: 0, cnt: 0 }, '90+': { total: 0, cnt: 0 } };
  topPend.forEach(p => {
    const k = p.dias <= 30 ? '0-30' : p.dias <= 60 ? '31-60' : p.dias <= 90 ? '61-90' : '90+';
    buckets[k].total += p.total;
    buckets[k].cnt += 1;
  });

  const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const estTagClass = (s: string) => s === 'Pagado' ? 'tag-green' : s === 'Cancelado' ? 'tag-red' : 'tag-yellow';

  const body = `
<!-- KPIs -->
<div class="kpi-row">
  <div class="kpi" style="border-top:3px solid ${COLORS.red}">
    <div class="label">$ Facturación Emitida YTD</div>
    <div class="value">${fmtFull(facturadoYTD)}</div>
    <div class="sub" style="color:${pctVarFact >= 0 ? COLORS.green : COLORS.red}">${pctVarFact >= 0 ? '+' : ''}${pctVarFact.toFixed(1)}% vs ${lastYear}</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.green}">
    <div class="label">$ Cobrado YTD</div>
    <div class="value">${fmtFull(pagadoYTD)}</div>
    <div class="sub" style="color:${pctVarCobro >= 0 ? COLORS.green : COLORS.red}">${pctVarCobro >= 0 ? '+' : ''}${pctVarCobro.toFixed(1)}% vs ${lastYear}</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.dark}">
    <div class="label">% Cobranza Efectiva</div>
    <div class="value">${pctCobrado.toFixed(1)}%</div>
    <div class="sub">de facturación ${year}</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.yellow}">
    <div class="label">$ Pendiente ${year}</div>
    <div class="value" style="color:${COLORS.yellow}">${fmtFull(pendienteYTD)}</div>
    <div class="sub">${(estData.find((e: any) => e.name === 'En Proceso de Pago')?.cnt || 0) + (estData.find((e: any) => e.name === 'Emitido')?.cnt || 0)} facturas</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.red}">
    <div class="label">$ Saldo Antiguo</div>
    <div class="value" style="color:${COLORS.red}">${fmtFull(factAntigua)}</div>
    <div class="sub">${factAntiguaCnt} facturas pre-${year}</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.gray}">
    <div class="label">$ Cancelado YTD</div>
    <div class="value">${fmtFull(cancelado)}</div>
    <div class="sub">${estData.find((e: any) => e.name === 'Cancelado')?.cnt || 0} facturas</div>
  </div>
</div>

<!-- ROW 1: Estatus donut + Política de pago + Condiciones -->
<div class="chart-row" style="grid-template-columns:1.2fr 1fr 1fr">
  <div class="chart-card">
    <h3>Facturación por Estatus ${year}</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="estatusChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Pendiente por Política de Pago</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="politicaChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Crédito vs Contado</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="condicionesChart"></canvas></div>
  </div>
</div>

<!-- ROW 2: Por mes stacked + Antigüedad saldos -->
<div class="chart-row" style="grid-template-columns:2fr 1fr">
  <div class="chart-card">
    <h3>Facturación Emitida vs Cobrada por Mes ${year}</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="mesChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Antigüedad de Saldos Pendientes</h3>
    <div class="chart-wrap" style="height:300px"><canvas id="antiguedadChart"></canvas></div>
  </div>
</div>

<!-- ROW 3: Uso CFDI -->
<div class="chart-row">
  <div class="chart-card" style="grid-column:1/-1">
    <h3>Por Uso de CFDI</h3>
    <div class="chart-wrap" style="height:240px"><canvas id="cfdiChart"></canvas></div>
  </div>
</div>

<!-- TABLA: Top facturas pendientes -->
<div class="table-card" style="margin-bottom:24px">
  <h3>Top 20 Facturas Pendientes de Cobro</h3>
  <table>
    <thead>
      <tr>
        <th>Factura</th>
        <th>Cuenta</th>
        <th style="text-align:right">Monto</th>
        <th>Estatus</th>
        <th>Emisión</th>
        <th>Política</th>
        <th style="text-align:right">Días</th>
      </tr>
    </thead>
    <tbody>
      ${topPend.map(p => `
      <tr>
        <td><strong>${(p.name || '—').toString().replace(/</g, '&lt;')}</strong></td>
        <td>${p.acct.replace(/</g, '&lt;')}</td>
        <td style="text-align:right;font-weight:500">${fmtFull(p.total)}</td>
        <td><span class="tag ${estTagClass(p.estatus)}">${p.estatus}</span></td>
        <td>${p.emision}</td>
        <td>${p.politica}</td>
        <td style="text-align:right;color:${p.dias > 60 ? COLORS.red : p.dias > 30 ? COLORS.yellow : COLORS.green}">${p.dias}d</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<!-- TABLA: Top cuentas con saldo -->
<div class="table-card">
  <h3>Top 10 Cuentas con Mayor Saldo Pendiente</h3>
  <table>
    <thead><tr><th>Cuenta</th><th style="text-align:right">$ Saldo</th><th style="text-align:right"># Facturas</th></tr></thead>
    <tbody>
      ${topAcc.map(a => `
      <tr>
        <td>${(a.name || '—').toString().replace(/</g, '&lt;')}</td>
        <td style="text-align:right;font-weight:500">${fmtFull(a.total)}</td>
        <td style="text-align:right;color:#6B7280">${a.cnt}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<script>
const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const fontDef = {family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11};
const fontSm = {family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:10};
function fmt(n){if(n==null||isNaN(n))return'$0';if(Math.abs(n)>=1e6)return'$'+(n/1e6).toFixed(1)+'M';if(Math.abs(n)>=1e3)return'$'+(n/1e3).toFixed(0)+'K';return'$'+n.toFixed(0)}
const estColors = {Pagado:'${COLORS.green}','En Proceso de Pago':'${COLORS.blue}',Emitido:'${COLORS.yellow}',Cancelado:'${COLORS.gray}'};

// 1. Estatus donut
const estData = ${JSON.stringify(estData)};
new Chart(document.getElementById('estatusChart'),{
  type:'doughnut',
  data:{labels:estData.map(d=>d.name),datasets:[{data:estData.map(d=>d.total),backgroundColor:estData.map(d=>estColors[d.name]||'${COLORS.gray}')}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:fontSm,boxWidth:10}},tooltip:{callbacks:{label:c=>c.label+': '+fmt(c.parsed)+' ('+estData[c.dataIndex].cnt+' fact.)'}}}}
});

// 2. Política de pago
const politicas = ${JSON.stringify(politicas)};
new Chart(document.getElementById('politicaChart'),{
  type:'bar',
  data:{labels:politicas.map(p=>p.name),datasets:[{data:politicas.map(p=>p.total),backgroundColor:'${COLORS.blue}',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.parsed.x)+' ('+politicas[c.dataIndex].cnt+' fact.)'}}},scales:{x:{ticks:{callback:v=>fmt(v),font:fontSm},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontSm}}}}
});

// 3. Condiciones (Crédito vs Contado)
const condiciones = ${JSON.stringify(condiciones)};
new Chart(document.getElementById('condicionesChart'),{
  type:'doughnut',
  data:{labels:condiciones.map(c=>c.name),datasets:[{data:condiciones.map(c=>c.total),backgroundColor:['${COLORS.red}','${COLORS.green}']}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:fontSm,boxWidth:10}},tooltip:{callbacks:{label:c=>c.label+': '+fmt(c.parsed)}}}}
});

// 4. Por mes (stacked)
new Chart(document.getElementById('mesChart'),{
  type:'bar',
  data:{labels:meses,datasets:[
    {label:'Cobrado',data:${JSON.stringify(factPagadoMes)},backgroundColor:'${COLORS.green}',borderRadius:4,stack:'a'},
    {label:'Pendiente',data:${JSON.stringify(factEmitidoMes)},backgroundColor:'${COLORS.yellow}',borderRadius:4,stack:'a'}
  ]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:fontDef,boxWidth:10}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+fmt(c.parsed.y)}}},scales:{y:{stacked:true,ticks:{callback:v=>fmt(v),font:fontDef},grid:{color:'#f0f0f0'}},x:{stacked:true,ticks:{font:fontDef}}}}
});

// 5. Antigüedad
const buckets = ${JSON.stringify(buckets)};
const bColors = {'0-30':'${COLORS.green}','31-60':'${COLORS.yellow}','61-90':'#F97316','90+':'${COLORS.red}'};
new Chart(document.getElementById('antiguedadChart'),{
  type:'bar',
  data:{labels:Object.keys(buckets),datasets:[{data:Object.values(buckets).map(b=>b.total),backgroundColor:Object.keys(buckets).map(k=>bColors[k]),borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.parsed.y)+' ('+Object.values(buckets)[c.dataIndex].cnt+' fact.)'}}},scales:{y:{ticks:{callback:v=>fmt(v),font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontDef}}}}
});

// 6. Uso CFDI
const usoCFDI = ${JSON.stringify(usoCFDI)};
new Chart(document.getElementById('cfdiChart'),{
  type:'bar',
  data:{labels:usoCFDI.map(u=>u.name),datasets:[{data:usoCFDI.map(u=>u.total),backgroundColor:'${COLORS.dark}',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.parsed.y)+' ('+usoCFDI[c.dataIndex].cnt+' fact.)'}}},scales:{y:{ticks:{callback:v=>fmt(v),font:fontDef},grid:{color:'#f0f0f0'}},x:{ticks:{font:fontSm}}}}
});
</script>`;

  return {
    id: 'cobranza',
    title: 'Cobranza',
    icon: '&#128179;',
    html: dashboardShell(`Cobranza y Facturación - ${year}`, date, body),
    generatedAt: now.toISOString(),
    summary: `Facturado: ${fmt(facturadoYTD)} | Cobrado: ${fmt(pagadoYTD)} (${pctCobrado.toFixed(0)}%) | Pendiente: ${fmt(pendienteYTD)} | Saldo antiguo: ${fmt(factAntigua)}`,
  };
}

// ─── Report 7: Distribución de Cuentas (réplica del PBI) ────────────────────

async function generateCuentas(query: QueryFn): Promise<ReportCache> {
  const now = new Date();
  const year = now.getFullYear();
  const lastYear = year - 1;

  const [
    porTipoCuenta,         // Account.Tipo_de_cuenta__c (Activo/Perdido/Nuevo/etc) — total
    porRegion,             // Cuentas con ventas por Región
    porSector,             // Cuentas con ventas por Sector
    porEstado,             // Cuentas con ventas por Estado mexicano
    porRango,              // Cuentas con ventas por Rango de Colaboradores
    porProducto,           // Cuentas con ventas por Producto Oportunidad (line items)
    porEstatusAnual,       // Cuentas con ventas por Estatus Anual (Nuevo/Renovación/Adicional)
    topVendedores,         // Top vendedores con # cuentas + $ Venta + Ticket
    topRecurrentes,        // Top cuentas recurrentes (con más años de compra)
    topNuevas,             // Top cuentas nuevas (Estatus_anual='Nuevo')
    cuentasGanadasYTD,     // # cuentas distintas con ventas YTD
    cuentasNuevasYTD,      // Distintas cuentas nuevas YTD
    cuentasNuevasMes,      // Cuentas creadas este mes
  ] = await Promise.all([
    query(`SELECT Tipo_de_cuenta__c t, COUNT(Id) cnt FROM Account WHERE Tipo_de_cuenta__c != null GROUP BY Tipo_de_cuenta__c ORDER BY COUNT(Id) DESC`),
    query(`SELECT Account.Regi_n_Cliente_UEN__c r, COUNT_DISTINCT(AccountId) cnt, SUM(Amount) total FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' AND Account.Regi_n_Cliente_UEN__c != null GROUP BY Account.Regi_n_Cliente_UEN__c ORDER BY COUNT_DISTINCT(AccountId) DESC`),
    query(`SELECT Account.Sector_MX__c s, COUNT_DISTINCT(AccountId) cnt, SUM(Amount) total FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' AND Account.Sector_MX__c != null GROUP BY Account.Sector_MX__c ORDER BY COUNT_DISTINCT(AccountId) DESC LIMIT 12`),
    query(`SELECT Account.Estado__c e, COUNT_DISTINCT(AccountId) cnt FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' AND Account.Estado__c != null GROUP BY Account.Estado__c ORDER BY COUNT_DISTINCT(AccountId) DESC LIMIT 15`),
    query(`SELECT Account.Rango_de_Colaboradores__c r, COUNT_DISTINCT(AccountId) cnt, SUM(Amount) total FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' AND Account.Rango_de_Colaboradores__c != null GROUP BY Account.Rango_de_Colaboradores__c ORDER BY SUM(Amount) DESC`),
    query(`SELECT Product2.Name p, COUNT_DISTINCT(Opportunity.AccountId) cnt, SUM(TotalPrice) total FROM OpportunityLineItem WHERE Opportunity.StageName='Ganada!' AND Opportunity.CloseDate=THIS_YEAR AND Opportunity.CurrencyIsoCode='MXN' GROUP BY Product2.Name ORDER BY COUNT_DISTINCT(Opportunity.AccountId) DESC LIMIT 12`),
    query(`SELECT Estatus_anual__c e, COUNT_DISTINCT(AccountId) cnt, SUM(Amount) total FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' AND Estatus_anual__c != null GROUP BY Estatus_anual__c`),
    query(`SELECT OwnerId, COUNT_DISTINCT(AccountId) cnt_acct, COUNT(Id) cnt_opp, SUM(Amount) total, AVG(Amount) avg FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' AND Amount != null GROUP BY OwnerId ORDER BY SUM(Amount) DESC NULLS LAST LIMIT 15`),
    query(`SELECT AccountId, Account.Name a, COUNT(Id) opps, SUM(Amount) total FROM Opportunity WHERE StageName='Ganada!' AND CurrencyIsoCode='MXN' AND Estatus_anual__c='Renovación' AND Amount > 0 GROUP BY AccountId, Account.Name HAVING COUNT(Id) >= 3 ORDER BY COUNT(Id) DESC NULLS LAST LIMIT 15`),
    query(`SELECT AccountId, Account.Name a, SUM(Amount) total, COUNT(Id) opps FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' AND Estatus_anual__c='Nuevo' AND Amount > 0 GROUP BY AccountId, Account.Name ORDER BY SUM(Amount) DESC NULLS LAST LIMIT 15`),
    query(`SELECT COUNT_DISTINCT(AccountId) cnt FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN'`),
    query(`SELECT COUNT_DISTINCT(AccountId) cnt, SUM(Amount) total FROM Opportunity WHERE StageName='Ganada!' AND CloseDate=THIS_YEAR AND CurrencyIsoCode='MXN' AND Estatus_anual__c='Nuevo'`),
    query(`SELECT COUNT(Id) cnt FROM Account WHERE CreatedDate=THIS_MONTH`),
  ]);

  // ── Procesamiento ──
  const tipoData = (porTipoCuenta.records || []).map((r: any) => ({ name: r.t, cnt: r.cnt }));
  const totalCuentas = tipoData.reduce((s: number, t: any) => s + t.cnt, 0);
  const cuentasActivas = tipoData.find((t: any) => t.name?.includes('Activo'))?.cnt || 0;
  const cuentasPerdidas = tipoData.find((t: any) => t.name?.includes('Perdido'))?.cnt || 0;
  const cuentasNuevasTipo = tipoData.find((t: any) => t.name?.includes('Nuevo'))?.cnt || 0;
  const cuentasSinActividad = tipoData.find((t: any) => t.name?.includes('Sin actividad'))?.cnt || 0;

  const cuentasConVentas = cuentasGanadasYTD.records?.[0]?.cnt || 0;
  const cuentasNuevasYTDcnt = cuentasNuevasYTD.records?.[0]?.cnt || 0;
  const ventaCuentasNuevasYTD = cuentasNuevasYTD.records?.[0]?.total || 0;
  const nuevasMes = cuentasNuevasMes.records?.[0]?.cnt || 0;

  const regionData = (porRegion.records || []).map((r: any) => ({ name: r.r, cnt: r.cnt, total: r.total || 0 }));
  const sectorData = (porSector.records || []).map((r: any) => ({ name: (r.s || '').replace(/^\d+\.0\s*/, ''), cnt: r.cnt, total: r.total || 0 }));
  const estadoData = (porEstado.records || []).map((r: any) => ({ name: r.e, cnt: r.cnt }));
  const rangoData = (porRango.records || []).map((r: any) => ({ name: r.r, cnt: r.cnt, total: r.total || 0 }));
  const productoData = (porProducto.records || []).map((r: any) => ({ name: r.p, cnt: r.cnt, total: r.total || 0 }));
  const estatusData = (porEstatusAnual.records || []).map((r: any) => ({ name: r.e, cnt: r.cnt, total: r.total || 0 }));

  // ── User name lookup ──
  const userNames = new Map<string, string>();
  try {
    const allUsers = await query(`SELECT Id, Name FROM User WHERE IsActive = true LIMIT 200`);
    (allUsers.records || []).forEach((u: any) => userNames.set(u.Id, u.Name));
  } catch (e: any) {
    process.stderr.write(`[reports] User query failed: ${e.message}\n`);
  }

  const topVend = (topVendedores.records || []).map((r: any) => ({
    name: userNames.get(r.OwnerId) || 'Sin nombre',
    cuentas: r.cnt_acct || 0,
    opps: r.cnt_opp || 0,
    total: r.total || 0,
    ticket: r.avg || 0,
  }));

  const topRec = (topRecurrentes.records || []).map((r: any) => ({
    name: r.a || '—',
    opps: r.opps || 0,
    total: r.total || 0,
  }));

  const topNew = (topNuevas.records || []).map((r: any) => ({
    name: r.a || '—',
    opps: r.opps || 0,
    total: r.total || 0,
  }));

  const tipoColors: Record<string, string> = {
    'Activo (Renewal)': COLORS.green, 'Perdido (Churn)': COLORS.red, 'Nuevo (New Logo)': COLORS.blue,
    'Recuperado (Winback)': '#8B5CF6', 'Sin actividad': COLORS.gray
  };

  const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const body = `
<!-- KPIs -->
<div class="kpi-row">
  <div class="kpi" style="border-top:3px solid ${COLORS.dark}">
    <div class="label">Total Cuentas</div>
    <div class="value">${totalCuentas.toLocaleString('es-MX')}</div>
    <div class="sub">${nuevasMes} creadas este mes</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.green}">
    <div class="label">Cuentas Activas (Renewal)</div>
    <div class="value" style="color:${COLORS.green}">${cuentasActivas.toLocaleString('es-MX')}</div>
    <div class="sub">${pct(cuentasActivas, totalCuentas)} del total</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.red}">
    <div class="label">Cuentas Perdidas (Churn)</div>
    <div class="value" style="color:${COLORS.red}">${cuentasPerdidas.toLocaleString('es-MX')}</div>
    <div class="sub">${pct(cuentasPerdidas, totalCuentas)} del total</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.blue}">
    <div class="label">Cuentas con Venta YTD</div>
    <div class="value">${cuentasConVentas.toLocaleString('es-MX')}</div>
    <div class="sub">en ${year}</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.yellow}">
    <div class="label"># Cuentas Nuevas YTD</div>
    <div class="value">${cuentasNuevasYTDcnt.toLocaleString('es-MX')}</div>
    <div class="sub">${fmt(ventaCuentasNuevasYTD)} en ventas</div>
  </div>
  <div class="kpi" style="border-top:3px solid ${COLORS.gray}">
    <div class="label">Sin Actividad Comercial</div>
    <div class="value">${cuentasSinActividad.toLocaleString('es-MX')}</div>
    <div class="sub">${pct(cuentasSinActividad, totalCuentas)} dormidas</div>
  </div>
</div>

<!-- ROW 1: Tipo de Cuenta + Estatus Anual + Rango Colaboradores -->
<div class="chart-row" style="grid-template-columns:1fr 1fr 1fr">
  <div class="chart-card">
    <h3>Tipo de Cuenta</h3>
    <div class="chart-wrap" style="height:280px"><canvas id="tipoChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Cuentas con Venta por Estatus Anual</h3>
    <div class="chart-wrap" style="height:280px"><canvas id="estatusChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3>Cuentas por Categoría Empresa</h3>
    <div class="chart-wrap" style="height:280px"><canvas id="rangoChart"></canvas></div>
  </div>
</div>

<!-- ROW 2: Región + Estado mexicano -->
<div class="chart-row" style="grid-template-columns:1fr 1fr">
  <div class="chart-card">
    <h3># Cuentas con Venta por Región</h3>
    <div class="chart-wrap" style="height:340px"><canvas id="regionChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3># Cuentas con Venta por Estado</h3>
    <div class="chart-wrap" style="height:340px"><canvas id="estadoChart"></canvas></div>
  </div>
</div>

<!-- ROW 3: Sector + Producto -->
<div class="chart-row" style="grid-template-columns:1fr 1fr">
  <div class="chart-card">
    <h3># Cuentas con Venta por Sector / Industria</h3>
    <div class="chart-wrap" style="height:360px"><canvas id="sectorChart"></canvas></div>
  </div>
  <div class="chart-card">
    <h3># Cuentas con Venta por Producto</h3>
    <div class="chart-wrap" style="height:360px"><canvas id="productoChart"></canvas></div>
  </div>
</div>

<!-- TABLA: Top vendedores -->
<div class="table-card" style="margin-bottom:24px">
  <h3>Top 15 Vendedores: Cuentas atendidas YTD</h3>
  <table>
    <thead><tr><th>Vendedor</th><th style="text-align:right"># Cuentas</th><th style="text-align:right"># Opps</th><th style="text-align:right">$ Venta</th><th style="text-align:right">$ Ticket Promedio</th></tr></thead>
    <tbody>
      ${topVend.map(v => `
      <tr>
        <td>${v.name.replace(/</g, '&lt;')}</td>
        <td style="text-align:right">${v.cuentas}</td>
        <td style="text-align:right;color:#6B7280">${v.opps}</td>
        <td style="text-align:right;font-weight:500">${fmtFull(v.total)}</td>
        <td style="text-align:right">${fmt(v.ticket)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<!-- ROW Tablas: Cuentas recurrentes + Cuentas nuevas -->
<div class="chart-row" style="grid-template-columns:1fr 1fr">
  <div class="table-card">
    <h3>Top 15 Cuentas Recurrentes (3+ renovaciones)</h3>
    <table>
      <thead><tr><th>Cuenta</th><th style="text-align:right"># Renovaciones</th><th style="text-align:right">$ Total</th></tr></thead>
      <tbody>
        ${topRec.map(c => `
        <tr>
          <td>${c.name.replace(/</g, '&lt;')}</td>
          <td style="text-align:right"><span class="tag tag-green">${c.opps}</span></td>
          <td style="text-align:right;font-weight:500">${fmtFull(c.total)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="table-card">
    <h3>Top 15 Cuentas Nuevas YTD (New Logos)</h3>
    <table>
      <thead><tr><th>Cuenta</th><th style="text-align:right"># Opps</th><th style="text-align:right">$ Venta</th></tr></thead>
      <tbody>
        ${topNew.map(c => `
        <tr>
          <td>${c.name.replace(/</g, '&lt;')}</td>
          <td style="text-align:right;color:#6B7280">${c.opps}</td>
          <td style="text-align:right;font-weight:500">${fmtFull(c.total)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</div>

<script>
const fontDef = {family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:11};
const fontSm = {family:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",size:10};
function fmt(n){if(n==null||isNaN(n))return'$0';if(Math.abs(n)>=1e6)return'$'+(n/1e6).toFixed(1)+'M';if(Math.abs(n)>=1e3)return'$'+(n/1e3).toFixed(0)+'K';return'$'+n.toFixed(0)}

// 1. Tipo de Cuenta (donut)
const tipoData = ${JSON.stringify(tipoData)};
const tipoColors = ${JSON.stringify(tipoColors)};
new Chart(document.getElementById('tipoChart'),{
  type:'doughnut',
  data:{labels:tipoData.map(t=>t.name),datasets:[{data:tipoData.map(t=>t.cnt),backgroundColor:tipoData.map(t=>tipoColors[t.name]||'${COLORS.gray}')}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:fontSm,boxWidth:10}},tooltip:{callbacks:{label:c=>c.label+': '+c.parsed.toLocaleString('es-MX')+' cuentas'}}}}
});

// 2. Estatus anual (donut)
const estatusData = ${JSON.stringify(estatusData)};
new Chart(document.getElementById('estatusChart'),{
  type:'doughnut',
  data:{labels:estatusData.map(d=>d.name),datasets:[{data:estatusData.map(d=>d.cnt),backgroundColor:['${COLORS.blue}','${COLORS.green}','${COLORS.yellow}','${COLORS.red}']}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:fontSm,boxWidth:10}},tooltip:{callbacks:{label:c=>c.label+': '+c.parsed+' cuentas | '+fmt(estatusData[c.dataIndex].total)}}}}
});

// 3. Rango Colaboradores
const rangoData = ${JSON.stringify(rangoData)};
new Chart(document.getElementById('rangoChart'),{
  type:'bar',
  data:{labels:rangoData.map(d=>d.name),datasets:[{data:rangoData.map(d=>d.cnt),backgroundColor:'${COLORS.red}',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.x+' cuentas | '+fmt(rangoData[c.dataIndex].total)}}},scales:{x:{ticks:{font:fontSm},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontSm}}}}
});

// 4. Región
const regionData = ${JSON.stringify(regionData)};
new Chart(document.getElementById('regionChart'),{
  type:'bar',
  data:{labels:regionData.map(d=>(d.name||'').replace('Región ','')),datasets:[{data:regionData.map(d=>d.cnt),backgroundColor:'${COLORS.blue}',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.x+' cuentas | '+fmt(regionData[c.dataIndex].total)}}},scales:{x:{ticks:{font:fontSm},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontSm}}}}
});

// 5. Estado
const estadoData = ${JSON.stringify(estadoData)};
new Chart(document.getElementById('estadoChart'),{
  type:'bar',
  data:{labels:estadoData.map(d=>d.name),datasets:[{data:estadoData.map(d=>d.cnt),backgroundColor:'${COLORS.green}',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{font:fontSm},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontSm}}}}
});

// 6. Sector
const sectorData = ${JSON.stringify(sectorData)};
new Chart(document.getElementById('sectorChart'),{
  type:'bar',
  data:{labels:sectorData.map(d=>(d.name||'').substring(0,30)),datasets:[{data:sectorData.map(d=>d.cnt),backgroundColor:'${COLORS.yellow}',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.x+' cuentas | '+fmt(sectorData[c.dataIndex].total)}}},scales:{x:{ticks:{font:fontSm},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontSm}}}}
});

// 7. Producto
const productoData = ${JSON.stringify(productoData)};
new Chart(document.getElementById('productoChart'),{
  type:'bar',
  data:{labels:productoData.map(d=>d.name),datasets:[{data:productoData.map(d=>d.cnt),backgroundColor:'${COLORS.dark}',borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.x+' cuentas | '+fmt(productoData[c.dataIndex].total)}}},scales:{x:{ticks:{font:fontSm},grid:{color:'#f0f0f0'}},y:{ticks:{font:fontSm}}}}
});
</script>`;

  return {
    id: 'cuentas',
    title: 'Distribución de Cuentas',
    icon: '&#127970;',
    html: dashboardShell(`Distribución de Cuentas - ${year}`, date, body),
    generatedAt: now.toISOString(),
    summary: `${totalCuentas.toLocaleString('es-MX')} cuentas | ${cuentasActivas} activas · ${cuentasPerdidas} churn | ${cuentasConVentas} con venta YTD | ${cuentasNuevasYTDcnt} new logos (${fmt(ventaCuentasNuevasYTD)})`,
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
