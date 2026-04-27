#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { join } from "path";
import { generateAllReports, type ReportCache } from "./reports";

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.GPTW_BOT_PORT ?? "8787");
const HOST = process.env.GPTW_BOT_HOST ?? "0.0.0.0";

// ─── Salesforce REST API client (lightweight, no jsforce needed) ───────────
const SF_USERNAME = process.env.SALESFORCE_USERNAME ?? "";
const SF_PASSWORD = process.env.SALESFORCE_PASSWORD ?? "";
const SF_TOKEN = process.env.SALESFORCE_TOKEN ?? "";
const SF_INSTANCE_URL = process.env.SALESFORCE_INSTANCE_URL ?? "";

let sfAccessToken = "";
let sfInstanceUrl = SF_INSTANCE_URL;

async function sfLogin(): Promise<void> {
  const loginUrl = SF_INSTANCE_URL.includes("my.salesforce.com")
    ? "https://login.salesforce.com/services/oauth2/token"
    : "https://login.salesforce.com/services/oauth2/token";

  const params = new URLSearchParams({
    grant_type: "password",
    client_id: "3MVG9I9urWMa_dmr_IFJMYN7oTaHjDXOSfOLgDuKOi.KAVNPeNePDwJpR4LkLpNaPUd0sVMGlHFSZQA78g7hL",
    client_secret: "",
    username: SF_USERNAME,
    password: SF_PASSWORD + SF_TOKEN,
  });

  // Try SOAP login as fallback (more reliable for username/password)
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com">
  <soapenv:Body>
    <urn:login>
      <urn:username>${SF_USERNAME}</urn:username>
      <urn:password>${SF_PASSWORD}${SF_TOKEN}</urn:password>
    </urn:login>
  </soapenv:Body>
</soapenv:Envelope>`;

  const soapRes = await fetch(`${SF_INSTANCE_URL}/services/Soap/u/59.0`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      SOAPAction: "login",
    },
    body: soapBody,
  });

  const soapText = await soapRes.text();
  const sessionIdMatch = soapText.match(/<sessionId>(.+?)<\/sessionId>/);
  const serverUrlMatch = soapText.match(/<serverUrl>(.+?)<\/serverUrl>/);

  if (sessionIdMatch) {
    sfAccessToken = sessionIdMatch[1];
    if (serverUrlMatch) {
      const url = new URL(serverUrlMatch[1]);
      sfInstanceUrl = `${url.protocol}//${url.hostname}`;
    }
    return;
  }

  throw new Error(`Salesforce login failed: ${soapText.substring(0, 500)}`);
}

async function sfQuery(soql: string): Promise<any> {
  if (!sfAccessToken) await sfLogin();

  const res = await fetch(
    `${sfInstanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
    { headers: { Authorization: `Bearer ${sfAccessToken}` } }
  );

  if (res.status === 401) {
    // Token expired, re-login
    await sfLogin();
    const retry = await fetch(
      `${sfInstanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
      { headers: { Authorization: `Bearer ${sfAccessToken}` } }
    );
    return retry.json();
  }

  return res.json();
}

async function sfDescribe(objectName: string): Promise<any> {
  if (!sfAccessToken) await sfLogin();

  const res = await fetch(
    `${sfInstanceUrl}/services/data/v59.0/sobjects/${objectName}/describe`,
    { headers: { Authorization: `Bearer ${sfAccessToken}` } }
  );

  if (res.status === 401) {
    await sfLogin();
    const retry = await fetch(
      `${sfInstanceUrl}/services/data/v59.0/sobjects/${objectName}/describe`,
      { headers: { Authorization: `Bearer ${sfAccessToken}` } }
    );
    return retry.json();
  }

  return res.json();
}

async function sfSearch(searchTerm: string): Promise<any> {
  if (!sfAccessToken) await sfLogin();

  const sosl = `FIND {${searchTerm}} IN ALL FIELDS RETURNING Account(Name), Opportunity(Name, StageName, Amount), Contact(Name, Email)`;
  const res = await fetch(
    `${sfInstanceUrl}/services/data/v59.0/search?q=${encodeURIComponent(sosl)}`,
    { headers: { Authorization: `Bearer ${sfAccessToken}` } }
  );

  if (res.status === 401) {
    await sfLogin();
    const retry = await fetch(
      `${sfInstanceUrl}/services/data/v59.0/search?q=${encodeURIComponent(sosl)}`,
      { headers: { Authorization: `Bearer ${sfAccessToken}` } }
    );
    return retry.json();
  }

  return res.json();
}

// ─── Report Cache & Scheduler (4am Mexico City = UTC-6) ──────────────────
let reportsCache: ReportCache[] = [];
let reportsGenerating = false;

async function refreshReports() {
  if (reportsGenerating) return;
  reportsGenerating = true;
  const start = Date.now();
  try {
    if (!sfAccessToken) await sfLogin();
    reportsCache = await generateAllReports(sfQuery);
    process.stderr.write(`[reports] Generated ${reportsCache.length} reports in ${((Date.now() - start) / 1000).toFixed(1)}s\n`);
  } catch (err: any) {
    process.stderr.write(`[reports] Error: ${err.message}\n`);
  } finally {
    reportsGenerating = false;
  }
}

// Schedule at 4am Mexico City (UTC-6) = 10:00 UTC
function scheduleNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(10, 0, 0, 0); // 4am Mexico = 10am UTC
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next.getTime() - now.getTime();
  setTimeout(async () => {
    await refreshReports();
    scheduleNextRun(); // schedule next day
  }, delay);
  process.stderr.write(`[reports] Next refresh at ${next.toISOString()} (in ${(delay / 3600000).toFixed(1)}h)\n`);
}

// Generate on startup (after 10s to let SF login settle) + schedule daily
setTimeout(() => { refreshReports(); scheduleNextRun(); }, 10000);

// ─── SSE connections per chat_id ───────────────────────────────────────────
const sseClients = new Map<string, Set<(data: string) => void>>();

function broadcastToChat(chatId: string, event: string, data: object) {
  const clients = sseClients.get(chatId);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const emit of clients) emit(payload);
}

// ─── Auth ──────────────────────────────────────────────────────────────────
const ACCESS_TOKEN = process.env.GPTW_ACCESS_TOKEN ?? "";

function checkAuth(req: Request): boolean {
  if (!ACCESS_TOKEN) return true;
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? req.headers.get("Authorization")?.replace("Bearer ", "");
  return token === ACCESS_TOKEN;
}

// ─── MCP Channel Server ───────────────────────────────────────────────────
const mcp = new Server(
  { name: "gptw-sales-bot", version: "1.0.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: `Eres el asistente de ventas de Great Place to Work. Los gerentes te escriben para consultar datos de Salesforce.

Los mensajes llegan como <channel source="gptw-sales-bot" chat_id="..." user_name="...">.
Responde SIEMPRE usando el tool "reply", pasando el chat_id del tag.

HERRAMIENTAS DISPONIBLES:
- "reply": para enviar respuestas al gerente (OBLIGATORIO para cada respuesta)
- "salesforce_query": para ejecutar consultas SOQL contra Salesforce
- "salesforce_describe": para ver la estructura de un objeto de Salesforce
- "salesforce_search": para buscar registros por texto

REGLAS:
- Responde en español, de forma clara y concisa.
- Cuando te pregunten por ventas, oportunidades, pipeline, etc., usa "salesforce_query" con SOQL.
- Formatea los números como moneda cuando aplique (ej: $1,234,567.00 MXN).
- Sé profesional pero amigable.
- Puedes usar emojis moderadamente para hacer las respuestas más legibles.
- Si te preguntan algo fuera de ventas/Salesforce, responde amablemente que tu especialidad es datos de ventas.
- SIEMPRE termina respondiendo con "reply" - nunca dejes un mensaje sin respuesta.

FLUJO DE TRABAJO CON STATUS UPDATES:
- ANTES de cada operacion importante, usa "send_status" para informar al usuario que esta pasando.
- Ejemplo de flujo:
  1. send_status: "Consultando oportunidades en Salesforce..."
  2. salesforce_query: (ejecuta la query)
  3. send_status: "Procesando 1,505 registros..."
  4. reply o send_artifact: (envia resultado)
- Los status se muestran como indicadores sutiles en el chat para que el usuario sepa que estas trabajando.

DASHBOARDS Y VISUALIZACIONES (MUY IMPORTANTE):
- Cuando el gerente pida dashboards, graficos, visualizaciones, o reportes visuales, usa "send_artifact".
- send_artifact envia un documento HTML COMPLETO que se renderiza en un panel lateral (como artefactos de Claude).
- El HTML debe ser un dashboard profesional y hermoso con:
  * KPIs en cards con iconos y colores
  * Graficos usando Chart.js (incluir <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>)
  * Tablas estilizadas
  * Colores de marca GPTW: rojo #FF1628, dark #11131C, azul #398ffc
  * Font: Inter de Google Fonts
  * Todo el CSS inline en el HTML
- Despues de enviar el artifact, usa "reply" con un mensaje corto como "Ya te genere el dashboard. Puedes verlo en el panel lateral."
- NO pongas los datos en formato tabla en el reply cuando hay artifact - el reply solo debe ser un mensaje corto.
- Para preguntas simples (ej: "cuantas oportunidades hay?") NO uses artifact, solo reply con texto.
- Usa artifact solo cuando pidan: dashboard, grafico, reporte visual, visualizacion, comparativa visual, etc.

PRESENTACIONES PARA JUNTA DIRECTIVA:
- Cuando el gerente pida una presentacion, slides, o algo para presentar a la junta, usa "send_artifact" con HTML de slides.
- El HTML debe tener multiples divs con class="slide" que la interfaz detecta y muestra con navegacion.
- Cada slide es una pagina completa con contenido (KPIs, graficos, bullet points, conclusiones).
- Estructura de una presentacion tipica:
  * Slide 1: Portada (titulo, fecha, logo conceptual)
  * Slide 2: Resumen ejecutivo / KPIs principales
  * Slide 3-5: Datos detallados con graficos
  * Slide 6: Top performers / Highlights
  * Slide 7: Conclusiones y recomendaciones
- Cada slide debe tener: fondo blanco, padding generoso, tipografia grande legible.
- INCLUIR Chart.js CDN y Google Fonts Inter en el head.

EJEMPLO DE HTML PARA PRESENTACION:
<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#f7f7f8;color:#11131C}
.slide{width:100%;min-height:100vh;padding:48px;display:flex;flex-direction:column;justify-content:center;background:white;border-bottom:1px solid #e5e5ea}
.slide-title{font-size:32px;font-weight:700;margin-bottom:8px}
.slide-subtitle{font-size:16px;color:#6b6c7b;margin-bottom:32px}
.kpi-row{display:flex;gap:24px;margin-bottom:32px;flex-wrap:wrap}
.kpi-card{flex:1;min-width:180px;background:#f7f7f8;border-radius:12px;padding:24px}
.kpi-card .value{font-size:36px;font-weight:700;color:#FF1628}
.kpi-card .label{font-size:14px;color:#6b6c7b;margin-top:4px}
.chart-container{background:#f7f7f8;border-radius:12px;padding:24px;margin-bottom:24px}
.accent-bar{width:60px;height:4px;background:#FF1628;border-radius:2px;margin-bottom:24px}
</style></head>
<body>
<div class="slide">
  <div class="accent-bar"></div>
  <div class="slide-title">Resultados de Ventas Q1 2026</div>
  <div class="slide-subtitle">Great Place to Work Mexico</div>
  <p style="font-size:18px;color:#6b6c7b;margin-top:auto">Preparado el 24 de marzo de 2026</p>
</div>
<div class="slide">
  <div class="accent-bar"></div>
  <div class="slide-title">Resumen Ejecutivo</div>
  <div class="kpi-row">
    <div class="kpi-card"><div class="value">$45.2M</div><div class="label">Ingresos Q1</div></div>
    <div class="kpi-card"><div class="value">1,505</div><div class="label">Oportunidades Abiertas</div></div>
  </div>
</div>
<!-- mas slides con graficos -->
<script>
// Chart.js charts aqui
</script>
</body></html>

EJEMPLO DE HTML PARA DASHBOARD (estructura basica):
<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#f7f7f8;padding:24px;color:#11131C}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.kpi{background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
.kpi-value{font-size:28px;font-weight:700;color:#FF1628}
.kpi-label{font-size:13px;color:#6b6c7b;margin-top:4px}
.chart-card{background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-bottom:16px}
.chart-title{font-size:14px;font-weight:600;margin-bottom:16px}
</style></head>
<body>
<h2 style="font-size:20px;font-weight:700;margin-bottom:20px">Dashboard de Ventas</h2>
<div class="kpi-grid">
  <div class="kpi"><div class="kpi-value">1,505</div><div class="kpi-label">Oportunidades Abiertas</div></div>
</div>
<div class="chart-card"><div class="chart-title">Pipeline</div><canvas id="chart1"></canvas></div>
<script>new Chart(document.getElementById('chart1'),{type:'bar',data:{...},options:{...}});</script>
</body></html>

EJEMPLOS DE QUERIES COMUNES:
- Oportunidades abiertas: SELECT COUNT(Id) FROM Opportunity WHERE IsClosed = false
- Ventas cerradas este mes: SELECT SUM(Amount) FROM Opportunity WHERE StageName = 'Closed Won' AND CloseDate = THIS_MONTH
- Pipeline por etapa: SELECT StageName, COUNT(Id) cnt, SUM(Amount) total FROM Opportunity WHERE IsClosed = false GROUP BY StageName
- Top vendedores: SELECT Owner.Name, SUM(Amount) total FROM Opportunity WHERE StageName = 'Closed Won' AND CloseDate = THIS_YEAR GROUP BY Owner.Name ORDER BY SUM(Amount) DESC LIMIT 10`,
  }
);

// ─── Tools ─────────────────────────────────────────────────────────────────
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Envía un mensaje de respuesta al gerente en la interfaz web del chat. Para respuestas finales.",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: { type: "string", description: "El ID del chat (del atributo chat_id del tag channel)" },
          text: { type: "string", description: "El mensaje de respuesta en markdown" },
        },
        required: ["chat_id", "text"],
      },
    },
    {
      name: "send_status",
      description: "Envía un mensaje de progreso/estado al gerente. Usa esto ANTES de cada operacion larga para que el usuario sepa que esta pasando. Ejemplo: 'Consultando Salesforce...', 'Procesando datos...', 'Generando dashboard...'",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: { type: "string", description: "El ID del chat" },
          text: { type: "string", description: "El mensaje de estado. Ejemplo: Consultando oportunidades en Salesforce..." },
        },
        required: ["chat_id", "text"],
      },
    },
    {
      name: "send_artifact",
      description: "Envía un dashboard/visualización HTML completo que se renderiza en un panel lateral (como artefactos de Claude). El HTML debe ser un documento completo con estilos inline, Chart.js, KPIs, y graficos. Usa esto cuando el gerente pida dashboards, graficos, reportes visuales o visualizaciones.",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: { type: "string", description: "El ID del chat" },
          title: { type: "string", description: "Título del dashboard/artefacto. Ejemplo: Dashboard de Ventas Q1 2026" },
          html: { type: "string", description: "El HTML completo del dashboard. Debe ser un documento HTML valido con <!DOCTYPE html>, estilos inline, Chart.js CDN, y todo el contenido." },
        },
        required: ["chat_id", "title", "html"],
      },
    },
    {
      name: "salesforce_query",
      description: "Ejecuta una consulta SOQL contra Salesforce y retorna los resultados. Usa esto para obtener datos de ventas, oportunidades, cuentas, contactos, etc.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "La consulta SOQL a ejecutar. Ejemplo: SELECT Id, Name, Amount, StageName FROM Opportunity WHERE IsClosed = false" },
        },
        required: ["query"],
      },
    },
    {
      name: "salesforce_describe",
      description: "Obtiene la metadata/estructura de un objeto de Salesforce (campos, tipos, relaciones). Útil para saber qué campos tiene un objeto antes de hacer una query.",
      inputSchema: {
        type: "object",
        properties: {
          object_name: { type: "string", description: "El nombre API del objeto. Ejemplo: Opportunity, Account, Contact" },
        },
        required: ["object_name"],
      },
    },
    {
      name: "salesforce_search",
      description: "Busca registros en Salesforce por texto libre usando SOSL. Busca en Accounts, Opportunities y Contacts.",
      inputSchema: {
        type: "object",
        properties: {
          search_term: { type: "string", description: "El término de búsqueda" },
        },
        required: ["search_term"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === "reply") {
    const { chat_id, text } = args as { chat_id: string; text: string };
    broadcastToChat(chat_id, "message", {
      role: "assistant",
      text,
      timestamp: new Date().toISOString(),
    });
    return { content: [{ type: "text", text: "sent" }] };
  }

  if (name === "send_status") {
    const { chat_id, text } = args as { chat_id: string; text: string };
    broadcastToChat(chat_id, "status", { text });
    return { content: [{ type: "text", text: "status sent" }] };
  }

  if (name === "send_artifact") {
    const { chat_id, title, html } = args as { chat_id: string; title: string; html: string };
    broadcastToChat(chat_id, "artifact", { title, html });
    return { content: [{ type: "text", text: `artifact "${title}" sent` }] };
  }

  if (name === "salesforce_query") {
    const { query } = args as { query: string };
    try {
      const result = await sfQuery(query);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error en query: ${e.message}` }], isError: true };
    }
  }

  if (name === "salesforce_describe") {
    const { object_name } = args as { object_name: string };
    try {
      const result = await sfDescribe(object_name);
      // Return only the most useful fields to avoid huge responses
      const summary = {
        name: result.name,
        label: result.label,
        fields: result.fields?.map((f: any) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          picklistValues: f.picklistValues?.length > 0 ? f.picklistValues.map((p: any) => p.value) : undefined,
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error en describe: ${e.message}` }], isError: true };
    }
  }

  if (name === "salesforce_search") {
    const { search_term } = args as { search_term: string };
    try {
      const result = await sfSearch(search_term);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error en búsqueda: ${e.message}` }], isError: true };
    }
  }

  throw new Error(`unknown tool: ${name}`);
});

// ─── Connect to Claude Code over stdio ────────────────────────────────────
await mcp.connect(new StdioServerTransport());

// ─── Serve the web UI and handle API routes ───────────────────────────────
const htmlPath = join(import.meta.dir, "public", "index.html");

let nextChatId = 1;

Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(readFileSync(htmlPath, "utf-8"), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }

    if (req.method === "GET" && url.pathname === "/events") {
      if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });

      const chatId = url.searchParams.get("chat_id");
      if (!chatId) return new Response("Missing chat_id", { status: 400 });

      const stream = new ReadableStream({
        start(ctrl) {
          const encoder = new TextEncoder();
          const emit = (chunk: string) => {
            try { ctrl.enqueue(encoder.encode(chunk)); } catch {}
          };

          if (!sseClients.has(chatId)) sseClients.set(chatId, new Set());
          sseClients.get(chatId)!.add(emit);

          emit(": connected\n\n");

          req.signal.addEventListener("abort", () => {
            sseClients.get(chatId)?.delete(emit);
            if (sseClients.get(chatId)?.size === 0) sseClients.delete(chatId);
          });
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    if (req.method === "POST" && url.pathname === "/message") {
      if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });

      const body = await req.json() as { text: string; chat_id?: string; user_name?: string };
      const chatId = body.chat_id ?? String(nextChatId++);
      const userName = body.user_name ?? "Gerente";

      await mcp.notification({
        method: "notifications/claude/channel",
        params: {
          content: body.text,
          meta: { chat_id: chatId, user_name: userName },
        },
      });

      return Response.json({ ok: true, chat_id: chatId });
    }

    if (req.method === "POST" && url.pathname === "/cancel") {
      if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });

      const body = await req.json() as { chat_id: string };
      const chatId = body.chat_id;

      // Broadcast cancel event to SSE clients so the UI knows it was cancelled
      broadcastToChat(chatId, "done", { message: "Solicitud cancelada por el usuario." });

      return Response.json({ ok: true, cancelled: true });
    }

    // Serve pre-cached reports list
    if (req.method === "GET" && url.pathname === "/reports") {
      if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
      const list = reportsCache.map(r => ({ id: r.id, title: r.title, icon: r.icon, summary: r.summary, generatedAt: r.generatedAt }));
      return Response.json({ reports: list, generating: reportsGenerating });
    }

    // Serve individual report HTML
    if (req.method === "GET" && url.pathname.startsWith("/reports/")) {
      if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
      const reportId = url.pathname.split("/reports/")[1];
      const report = reportsCache.find(r => r.id === reportId);
      if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
      return Response.json(report);
    }

    // Force refresh reports
    if (req.method === "POST" && url.pathname === "/reports/refresh") {
      if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
      refreshReports(); // async, don't await
      return Response.json({ ok: true, message: "Refresh started" });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", timestamp: new Date().toISOString() });
    }

    return new Response("Not Found", { status: 404 });
  },
});

const stderr = (msg: string) => process.stderr.write(msg + "\n");
stderr(`gptw-sales-bot: http://${HOST}:${PORT}`);
stderr(`Access token: ${ACCESS_TOKEN ? "enabled" : "disabled (dev mode)"}`);
