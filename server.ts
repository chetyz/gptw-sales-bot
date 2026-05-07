#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
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
// Bind chat_id ↔ user_id + el sb client del user, para loguear artifacts del bot
// usando la identidad del user dueño del chat (RLS feliz).
const chatOwners = new Map<string, string>();
const chatSbClients = new Map<string, any>();

function broadcastToChat(chatId: string, event: string, data: object) {
  const clients = sseClients.get(chatId);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const emit of clients) emit(payload);
}

function logArtifactForChat(chatId: string, title: string) {
  const userId = chatOwners.get(chatId);
  const sb = chatSbClients.get(chatId);
  if (!userId || !sb) return;
  sb.from("events").insert({ user_id: userId, type: "artifact_generated", metadata: { chat_id: chatId, title } }).then(({ error }: any) => {
    if (error) process.stderr.write(`[events] artifact_generated insert failed: ${error.message}\n`);
  });
}

// ─── Auth (Supabase JWT con fallback a token estático) ────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN ?? "").trim().toLowerCase();
const ACCESS_TOKEN = process.env.GPTW_ACCESS_TOKEN ?? "";

const supabase = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;

type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  role: "admin" | "user";
  can_chat: boolean;
  can_view_reports: boolean;
  can_save_reports: boolean;
  can_generate_charts: boolean;
  can_export: boolean;
};

type Permission = keyof Pick<
  Profile,
  "can_chat" | "can_view_reports" | "can_save_reports" | "can_generate_charts" | "can_export"
>;

type AuthCtx = {
  user: { id: string; email: string };
  profile: Profile;
  jwt: string;
  // Per-request Supabase client carrying the user's JWT, so RLS + auth.uid() works.
  sb: ReturnType<typeof createClient>;
};

const DEV_PROFILE: Profile = {
  id: "dev",
  email: "dev@local",
  display_name: "Dev",
  role: "admin",
  can_chat: true,
  can_view_reports: true,
  can_save_reports: true,
  can_generate_charts: true,
  can_export: true,
};

function extractToken(req: Request): string | null {
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;
  const header = req.headers.get("Authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

async function validateAuth(req: Request): Promise<AuthCtx | null> {
  // Modo dev: sin Supabase configurado, devolver un perfil con todos los permisos.
  if (!supabase) {
    if (!ACCESS_TOKEN) return { user: { id: "dev", email: "dev@local" }, profile: DEV_PROFILE, jwt: "", sb: null as any };
    const t = extractToken(req);
    if (t !== ACCESS_TOKEN) return null;
    return { user: { id: "static", email: "static@token" }, profile: { ...DEV_PROFILE, id: "static", email: "static@token" }, jwt: t, sb: null as any };
  }

  const token = extractToken(req);
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.email) return null;

  const email = data.user.email.toLowerCase();
  if (ALLOWED_EMAIL_DOMAIN && !email.endsWith("@" + ALLOWED_EMAIL_DOMAIN)) return null;

  // Cliente por request con el JWT del user → RLS sees auth.uid() = user.id.
  const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error: profErr } = await sb
    .from("profiles")
    .select("id, email, display_name, role, can_chat, can_view_reports, can_save_reports, can_generate_charts, can_export")
    .eq("id", data.user.id)
    .single();

  if (profErr || !profile) return null;

  return {
    user: { id: data.user.id, email },
    profile: profile as Profile,
    jwt: token,
    sb,
  };
}

function requirePermission(ctx: AuthCtx, perm: Permission): Response | null {
  if (ctx.profile[perm]) return null;
  return new Response(JSON.stringify({ error: "Forbidden", missing_permission: perm }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

function requireAdmin(ctx: AuthCtx): Response | null {
  if (ctx.profile.role === "admin") return null;
  return new Response(JSON.stringify({ error: "Admin only" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

// Fire-and-forget event logger. Doesn't block the response.
function logEvent(ctx: AuthCtx, type: "login" | "chat_message" | "artifact_generated" | "report_viewed" | "report_exported", metadata: object = {}) {
  if (!ctx.sb) return;
  ctx.sb.from("events").insert({ user_id: ctx.user.id, type, metadata }).then(({ error }) => {
    if (error) process.stderr.write(`[events] ${type} insert failed: ${error.message}\n`);
  });
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
    logArtifactForChat(chat_id, title);
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

function renderIndexHtml(): string {
  const raw = readFileSync(htmlPath, "utf-8");
  return raw
    .replaceAll("__SUPABASE_URL__", SUPABASE_URL)
    .replaceAll("__SUPABASE_PUBLISHABLE_KEY__", SUPABASE_PUBLISHABLE_KEY);
}

let nextChatId = 1;

// ─── Relogin helpers (manual OAuth refresh via tmux) ──────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function tmuxRun(args: string[]): Promise<string> {
  const proc = Bun.spawn(["tmux", ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

async function tmuxSend(...keys: string[]): Promise<void> {
  await tmuxRun(["send-keys", "-t", "bot", ...keys]);
}

async function tmuxCapture(): Promise<string> {
  return await tmuxRun(["capture-pane", "-t", "bot", "-p", "-S", "-120"]);
}

const RELOGIN_HTML = `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relogin - GPTW Bot</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#11131C;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#1a1d2a;border-radius:16px;padding:32px;max-width:560px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.4)}
h1{font-size:22px;margin-bottom:8px}
.sub{color:#9ca3af;font-size:14px;margin-bottom:24px}
.step{margin-bottom:20px;padding:16px;background:#11131C;border-radius:10px;border-left:3px solid #FF1628}
.step-num{font-size:12px;color:#FF1628;font-weight:700;letter-spacing:1px;margin-bottom:6px}
.step-title{font-weight:600;margin-bottom:8px}
.btn{background:#FF1628;color:#fff;border:none;padding:12px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-family:inherit;font-size:14px;width:100%}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.btn:hover:not(:disabled){background:#e0142a}
input{width:100%;background:#0a0c14;border:1px solid #2a2d3a;color:#fff;padding:12px;border-radius:8px;font-family:'JetBrains Mono',monospace;font-size:13px;margin-bottom:8px}
input:focus{outline:none;border-color:#FF1628}
.url{background:#0a0c14;padding:12px;border-radius:8px;font-family:monospace;font-size:11px;word-break:break-all;color:#398ffc;margin-bottom:8px;max-height:120px;overflow:auto}
.status{padding:12px;border-radius:8px;font-size:13px;margin-top:8px}
.status.ok{background:#0e3622;color:#4ade80;border:1px solid #166534}
.status.err{background:#3a1010;color:#f87171;border:1px solid #7f1d1d}
.status.info{background:#0e2436;color:#60a5fa;border:1px solid #1e3a5f}
.hidden{display:none}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
a{color:#398ffc;text-decoration:none}
a:hover{text-decoration:underline}
.copy-btn{background:#2a2d3a;border:none;color:#fff;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit}
.copy-btn:hover{background:#3a3d4a}
</style></head>
<body>
<div class="card">
  <h1>🔐 Relogin GPTW Bot</h1>
  <p class="sub">Renová la sesión OAuth de Claude Code cuando el bot deje de responder con error 401.</p>

  <div class="step">
    <div class="step-num">PASO 1</div>
    <div class="step-title">Iniciar el flow de login</div>
    <button class="btn" id="startBtn">Generar link OAuth</button>
    <div id="step1Status"></div>
  </div>

  <div class="step hidden" id="step2">
    <div class="step-num">PASO 2</div>
    <div class="step-title">Abrí el link, autorizá con tu cuenta y pegá el código</div>
    <div class="url" id="oauthUrl"></div>
    <button class="copy-btn" id="copyBtn" style="margin-bottom:12px">Copiar link</button>
    <a id="openLink" target="_blank" rel="noopener" style="display:inline-block;margin-bottom:12px;margin-left:8px;font-size:13px">Abrir en pestaña nueva ↗</a>
    <input type="text" id="codeInput" placeholder="xxxxx#yyyyy" autocomplete="off">
    <button class="btn" id="submitBtn">Enviar código</button>
    <div id="step2Status"></div>
  </div>
</div>
<script>
const params = new URLSearchParams(window.location.search);
const token = params.get('token') || '';
const authHeaders = { 'Content-Type': 'application/json' };
if (token) authHeaders['Authorization'] = 'Bearer ' + token;

function setStatus(el, msg, kind) {
  el.innerHTML = '<div class="status ' + kind + '">' + msg + '</div>';
}

document.getElementById('startBtn').addEventListener('click', async () => {
  const btn = document.getElementById('startBtn');
  const status = document.getElementById('step1Status');
  btn.disabled = true;
  setStatus(status, '<span class="spinner"></span>Generando link OAuth (espera ~10s)...', 'info');
  try {
    const res = await fetch('/relogin/start', { method: 'POST', headers: authHeaders });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setStatus(status, '❌ ' + (data.error || 'Error: ' + res.status) + (data.screen ? '<pre style="margin-top:8px;font-size:10px;white-space:pre-wrap">' + data.screen + '</pre>' : ''), 'err');
      btn.disabled = false;
      return;
    }
    setStatus(status, '✅ Link generado', 'ok');
    document.getElementById('step2').classList.remove('hidden');
    document.getElementById('oauthUrl').textContent = data.url;
    document.getElementById('openLink').href = data.url;
    document.getElementById('codeInput').focus();
  } catch (e) {
    setStatus(status, '❌ Error de red: ' + e.message, 'err');
    btn.disabled = false;
  }
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  const url = document.getElementById('oauthUrl').textContent;
  await navigator.clipboard.writeText(url);
  document.getElementById('copyBtn').textContent = '¡Copiado!';
  setTimeout(() => { document.getElementById('copyBtn').textContent = 'Copiar link'; }, 1500);
});

document.getElementById('submitBtn').addEventListener('click', async () => {
  const btn = document.getElementById('submitBtn');
  const status = document.getElementById('step2Status');
  const code = document.getElementById('codeInput').value.trim();
  if (!code) { setStatus(status, '❌ Pegá el código primero', 'err'); return; }
  btn.disabled = true;
  setStatus(status, '<span class="spinner"></span>Inyectando código y verificando...', 'info');
  try {
    const res = await fetch('/relogin/code', { method: 'POST', headers: authHeaders, body: JSON.stringify({ code }) });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setStatus(status, '❌ ' + (data.error || 'Error: ' + res.status) + (data.screen ? '<pre style="margin-top:8px;font-size:10px;white-space:pre-wrap">' + data.screen + '</pre>' : ''), 'err');
      btn.disabled = false;
      return;
    }
    setStatus(status, '✅ Login exitoso. El bot ya debería responder normalmente.', 'ok');
  } catch (e) {
    setStatus(status, '❌ Error de red: ' + e.message, 'err');
    btn.disabled = false;
  }
});
</script>
</body></html>`;

Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/auth/callback")) {
      return new Response(renderIndexHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }

    // GET /me — quien soy y mis permisos. El frontend lo usa para condicionar UI.
    if (req.method === "GET" && url.pathname === "/me") {
      const ctx = await validateAuth(req);
      if (!ctx) return new Response("Unauthorized", { status: 401 });
      return Response.json({ user: ctx.user, profile: ctx.profile });
    }

    // POST /auth/login — registra login event y actualiza last_login_at.
    if (req.method === "POST" && url.pathname === "/auth/login") {
      const ctx = await validateAuth(req);
      if (!ctx) return new Response("Unauthorized", { status: 401 });
      logEvent(ctx, "login");
      if (ctx.sb) ctx.sb.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", ctx.user.id).then(() => {});
      return Response.json({ ok: true });
    }

    if (req.method === "GET" && url.pathname === "/events") {
      const ctx = await validateAuth(req);
      if (!ctx) return new Response("Unauthorized", { status: 401 });

      const chatId = url.searchParams.get("chat_id");
      if (!chatId) return new Response("Missing chat_id", { status: 400 });

      // Asociar chat → user para poder loguear artifact_generated después
      chatOwners.set(chatId, ctx.user.id);

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
      const ctx = await validateAuth(req);
      if (!ctx) return new Response("Unauthorized", { status: 401 });
      const denied = requirePermission(ctx, "can_chat");
      if (denied) return denied;

      const body = await req.json() as { text: string; chat_id?: string; user_name?: string };
      const chatId = body.chat_id ?? String(nextChatId++);
      const userName = body.user_name ?? ctx.profile.display_name ?? "Gerente";

      // Bind del chat al user para el logging de artifact_generated
      chatOwners.set(chatId, ctx.user.id);
      // Guardar el sb client del user (para insertar events bajo su JWT)
      if (ctx.sb) chatSbClients.set(chatId, ctx.sb);

      logEvent(ctx, "chat_message", { chat_id: chatId, length: body.text.length });

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
      const ctx = await validateAuth(req);
      if (!ctx) return new Response("Unauthorized", { status: 401 });

      const body = await req.json() as { chat_id: string };
      const chatId = body.chat_id;

      broadcastToChat(chatId, "done", { message: "Solicitud cancelada por el usuario." });

      return Response.json({ ok: true, cancelled: true });
    }

    // Serve pre-cached reports list
    if (req.method === "GET" && url.pathname === "/reports") {
      const ctx = await validateAuth(req);
      if (!ctx) return new Response("Unauthorized", { status: 401 });
      const denied = requirePermission(ctx, "can_view_reports");
      if (denied) return denied;
      const list = reportsCache.map(r => ({ id: r.id, title: r.title, icon: r.icon, summary: r.summary, generatedAt: r.generatedAt }));
      return Response.json({ reports: list, generating: reportsGenerating });
    }

    // Serve individual report HTML
    if (req.method === "GET" && url.pathname.startsWith("/reports/")) {
      const ctx = await validateAuth(req);
      if (!ctx) return new Response("Unauthorized", { status: 401 });
      const denied = requirePermission(ctx, "can_view_reports");
      if (denied) return denied;
      const reportId = url.pathname.split("/reports/")[1];
      const report = reportsCache.find(r => r.id === reportId);
      if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
      logEvent(ctx, "report_viewed", { report_id: reportId, title: report.title });
      return Response.json(report);
    }

    // Force refresh reports — solo admin.
    if (req.method === "POST" && url.pathname === "/reports/refresh") {
      const ctx = await validateAuth(req);
      if (!ctx) return new Response("Unauthorized", { status: 401 });
      const denied = requireAdmin(ctx);
      if (denied) return denied;
      refreshReports();
      return Response.json({ ok: true, message: "Refresh started" });
    }

    // ─── ADMIN ENDPOINTS ──────────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/admin/users") {
      const ctx = await validateAuth(req);
      if (!ctx) return new Response("Unauthorized", { status: 401 });
      const denied = requireAdmin(ctx);
      if (denied) return denied;

      const { data, error } = await ctx.sb
        .from("profiles")
        .select("id, email, display_name, role, can_chat, can_view_reports, can_save_reports, can_generate_charts, can_export, created_at, last_login_at")
        .order("created_at", { ascending: true });
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ users: data });
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/admin/users/")) {
      const ctx = await validateAuth(req);
      if (!ctx) return new Response("Unauthorized", { status: 401 });
      const denied = requireAdmin(ctx);
      if (denied) return denied;

      const userId = url.pathname.split("/admin/users/")[1];
      const body = await req.json() as Partial<Profile>;

      // Whitelist de campos editables
      const allowed: Partial<Profile> = {};
      const fields: (keyof Profile)[] = ["role", "can_chat", "can_view_reports", "can_save_reports", "can_generate_charts", "can_export"];
      for (const f of fields) if (f in body) (allowed as any)[f] = (body as any)[f];

      const { data, error } = await ctx.sb.from("profiles").update(allowed).eq("id", userId).select().single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ profile: data });
    }

    if (req.method === "GET" && url.pathname === "/admin/analytics") {
      const ctx = await validateAuth(req);
      if (!ctx) return new Response("Unauthorized", { status: 401 });
      const denied = requireAdmin(ctx);
      if (denied) return denied;

      // Default: últimos 30 días
      const to = url.searchParams.get("to") ?? new Date().toISOString();
      const fromDefault = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const from = url.searchParams.get("from") ?? fromDefault;
      const userIdFilter = url.searchParams.get("user_id");

      let q = ctx.sb.from("events")
        .select("type, user_id, created_at")
        .gte("created_at", from)
        .lte("created_at", to);
      if (userIdFilter) q = q.eq("user_id", userIdFilter);

      const { data: events, error } = await q;
      if (error) return Response.json({ error: error.message }, { status: 500 });

      // Agregar en JS (volumen chico)
      const totals: Record<string, number> = {};
      const byDay: Record<string, Record<string, number>> = {}; // day → type → count
      const byUser: Record<string, Record<string, number>> = {}; // user_id → type → count

      for (const e of events ?? []) {
        totals[e.type] = (totals[e.type] ?? 0) + 1;
        const day = (e.created_at as string).slice(0, 10);
        if (!byDay[day]) byDay[day] = {};
        byDay[day][e.type] = (byDay[day][e.type] ?? 0) + 1;
        if (e.user_id) {
          if (!byUser[e.user_id]) byUser[e.user_id] = {};
          byUser[e.user_id][e.type] = (byUser[e.user_id][e.type] ?? 0) + 1;
        }
      }

      // Total de profiles para el KPI "users registrados"
      const { count: usersCount } = await ctx.sb
        .from("profiles")
        .select("id", { count: "exact", head: true });

      return Response.json({ from, to, totals, byDay, byUser, usersCount: usersCount ?? 0 });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", timestamp: new Date().toISOString() });
    }

    // Relogin UI page
    if (req.method === "GET" && url.pathname === "/relogin") {
      return new Response(RELOGIN_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }

    // Start OAuth flow: send /login to tmux, capture URL
    if (req.method === "POST" && url.pathname === "/relogin/start") {
      if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
      try {
        await tmuxSend("C-u");
        await sleep(300);
        await tmuxSend("/login", "Enter");
        await sleep(2500);
        await tmuxSend("Enter"); // selecciona opción 1 (Claude subscription, ya marcada)
        await sleep(5000);
        const screen = await tmuxCapture();
        // La URL puede venir partida en líneas; reconstruir uniendo trims
        const joined = screen.split("\n").map(l => l.trim()).join("");
        const m = joined.match(/https:\/\/claude\.com\/cai\/oauth\/authorize\?[^\s]+/);
        if (m) return Response.json({ ok: true, url: m[0] });
        return Response.json({ ok: false, error: "URL OAuth no encontrada en tmux", screen: screen.slice(-800) });
      } catch (e: any) {
        return Response.json({ ok: false, error: e.message ?? String(e) }, { status: 500 });
      }
    }

    // Submit OAuth code: inject into tmux with -l, confirm with Enter, verify
    if (req.method === "POST" && url.pathname === "/relogin/code") {
      if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
      try {
        const body = await req.json() as { code?: string };
        const code = (body.code ?? "").trim();
        if (!code) return Response.json({ ok: false, error: "Código vacío" }, { status: 400 });
        if (!/^[A-Za-z0-9_\-#]+$/.test(code)) {
          return Response.json({ ok: false, error: "Formato de código inválido" }, { status: 400 });
        }
        await tmuxSend("-l", code);
        await sleep(500);
        await tmuxSend("Enter");
        await sleep(4000);
        let screen = await tmuxCapture();
        if (screen.includes("Login successful")) {
          await tmuxSend("Enter"); // cierra el diálogo
          return Response.json({ ok: true, message: "Login exitoso" });
        }
        return Response.json({ ok: false, error: "Login no confirmado", screen: screen.slice(-800) });
      } catch (e: any) {
        return Response.json({ ok: false, error: e.message ?? String(e) }, { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

const stderr = (msg: string) => process.stderr.write(msg + "\n");
stderr(`gptw-sales-bot: http://${HOST}:${PORT}`);
stderr(`Auth: ${supabase ? `Supabase (${ALLOWED_EMAIL_DOMAIN ? "domain=" + ALLOWED_EMAIL_DOMAIN : "any email"})` : ACCESS_TOKEN ? "static token" : "disabled (dev mode)"}`);
