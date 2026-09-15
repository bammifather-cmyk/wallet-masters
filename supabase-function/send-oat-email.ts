// send-oat-email — OAT Trades notification sender
// Sends transactional emails from oattradessupport@gmail.com via Gmail SMTP over TLS.
// Same minimal-SMTP pattern as functions/send-email (Render blocks outbound SMTP;
// Supabase Edge Functions can reach smtp.gmail.com:465 directly).

const MAIL_KEY = "2906d9bcb33dcf197cc3dca3267b359670b8900f22106df5";
const GMAIL_USER = "oattradessupport@gmail.com";
const GMAIL_APP_PASSWORD = "teci zqey vlin onsh".replace(/\s+/g, "");

const enc = new TextEncoder();

class SmtpClient {
  conn: Deno.TlsConn;
  buf = "";

  constructor(conn: Deno.TlsConn) { this.conn = conn; }

  async readLine(): Promise<string> {
    let idx = this.buf.indexOf("\r\n");
    while (idx === -1) {
      const tmp = new Uint8Array(4096);
      const n = await this.conn.read(tmp);
      if (n === null) throw new Error("SMTP: connection closed");
      this.buf += new TextDecoder().decode(tmp.subarray(0, n));
      idx = this.buf.indexOf("\r\n");
    }
    const line = this.buf.slice(0, idx);
    this.buf = this.buf.slice(idx + 2);
    return line;
  }

  async expect(code: string) {
    let line = await this.readLine();
    while (!(line.length >= 4 && line[3] === " ")) line = await this.readLine(); // skip multi-line EHLO responses
    if (!line.startsWith(code)) throw new Error(`SMTP: expected ${code}, got ${line.slice(0, 120)}`);
    return line;
  }

  async write(s: string) {
    const data = enc.encode(s);
    let off = 0;
    while (off < data.length) {
      const n = await this.conn.write(data.subarray(off));
      if (n === 0) throw new Error("SMTP: zero-byte write");
      off += n;
    }
  }

  static async connect(): Promise<SmtpClient> {
    const conn = await Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });
    const c = new SmtpClient(conn);
    await c.expect("220");
    await c.write("EHLO oat-trades\r\n");
    await c.expect("250");
    await c.write("AUTH LOGIN\r\n");
    await c.expect("334");
    await c.write(btoa(GMAIL_USER) + "\r\n");
    await c.expect("334");
    await c.write(btoa(GMAIL_APP_PASSWORD) + "\r\n");
    await c.expect("235");
    return c;
  }

  async send(to: string, subject: string, html: string) {
    await this.write(`MAIL FROM:<${GMAIL_USER}>\r\n`);
    await this.expect("250");
    await this.write(`RCPT TO:<${to}>\r\n`);
    await this.expect("250");
    await this.write("DATA\r\n");
    await this.expect("354");
    const boundary = "oat_" + Date.now() + Math.random().toString(36).slice(2);
    const headers =
      `From: "OAT Trades" <${GMAIL_USER}>\r\n` +
      `To: <${to}>\r\n` +
      `Subject: ${subject}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
    const plain = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
    const body =
      `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n` +
      plain + `\r\n` +
      `--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n` +
      html + `\r\n\r\n--${boundary}--\r\n`;
    const msg = headers + body;
    const stuffed = msg.replace(/\r\n\./g, "\r\n..");
    await this.write(stuffed + "\r\n.\r\n");
    await this.expect("250");
  }

  async quit() {
    try { await this.write("QUIT\r\n"); } catch { /* ignore */ }
    try { this.conn.close(); } catch { /* ignore */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  try {
    const { key, to, subject, html } = await req.json();
    if (key !== MAIL_KEY) return Response.json({ success: false, error: "bad key" }, { status: 403 });
    if (!to || !subject || !html) return Response.json({ success: false, error: "missing fields" }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return Response.json({ success: false, error: "bad recipient" }, { status: 400 });

    const client = await SmtpClient.connect();
    try {
      await client.send(to, subject, html);
    } finally {
      await client.quit();
    }
    return Response.json({ success: true, to });
  } catch (e) {
    return Response.json({ success: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
});
