const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.csv");
const INDEX_FILE = path.join(DATA_DIR, "claims.json");

const BENEFIT = {
  title: "2 קינוחים במתנה",
  description: "בהזמנת ארוחה במסעדה, בכפוף לתנאי המקום.",
  validDesserts: "קינוחי הבית המשתתפים בהטבה"
};

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LEADS_FILE)) {
    fs.writeFileSync(
      LEADS_FILE,
      "\uFEFFcreatedAt,fullName,phone,email,marketingConsent,couponCode\n",
      "utf8"
    );
  }
  if (!fs.existsSync(INDEX_FILE)) {
    fs.writeFileSync(INDEX_FILE, JSON.stringify({ claims: [] }, null, 2), "utf8");
  }
}

function readClaims() {
  ensureDataFiles();
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
    return Array.isArray(parsed.claims) ? parsed.claims : [];
  } catch {
    return [];
  }
}

function saveClaims(claims) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify({ claims }, null, 2), "utf8");
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("972")) return `0${digits.slice(3)}`;
  return digits;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function isValidLead(input) {
  const fullName = String(input.fullName || "").trim();
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  return (
    fullName.length >= 2 &&
    phone.length >= 9 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

async function claimBenefit(input) {
  const fullName = String(input.fullName || "").trim().replace(/\s+/g, " ");
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const marketingConsent = Boolean(input.marketingConsent);

  if (!isValidLead({ fullName, phone, email })) {
    return { status: 400, payload: { error: "missing_fields" } };
  }

  const createdAt = new Date().toISOString();
  const couponCode = `DESSERT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  if (process.env.GOOGLE_SHEETS_WEBHOOK_URL) {
    try {
      const response = await fetch(process.env.GOOGLE_SHEETS_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          createdAt,
          fullName,
          phone,
          email,
          marketingConsent,
          couponCode
        })
      });
      const payload = await response.json();

      if (payload.error === "already_claimed") {
        return {
          status: 409,
          payload: {
            error: "already_claimed",
            couponCode: payload.couponCode,
            claimedAt: payload.claimedAt
          }
        };
      }

      if (!response.ok || payload.error) {
        return { status: 502, payload: { error: "sheets_unavailable" } };
      }

      return {
        status: 201,
        payload: {
          couponCode: payload.couponCode || couponCode,
          benefit: BENEFIT,
          message: "ההטבה נשמרה בהצלחה"
        }
      };
    } catch {
      return { status: 502, payload: { error: "sheets_unavailable" } };
    }
  }

  const claims = readClaims();
  const duplicate = claims.find((claim) => claim.phone === phone || claim.email === email);
  if (duplicate) {
    return {
      status: 409,
      payload: {
        error: "already_claimed",
        couponCode: duplicate.couponCode,
        claimedAt: duplicate.createdAt
      }
    };
  }

  const claim = { createdAt, fullName, phone, email, marketingConsent, couponCode };
  claims.push(claim);
  saveClaims(claims);

  fs.appendFileSync(
    LEADS_FILE,
    [
      csvCell(createdAt),
      csvCell(fullName),
      csvCell(phone),
      csvCell(email),
      csvCell(marketingConsent ? "כן" : "לא"),
      csvCell(couponCode)
    ].join(",") + "\n",
    "utf8"
  );

  return {
    status: 201,
    payload: {
      couponCode,
      benefit: BENEFIT,
      message: "ההטבה נשמרה בהצלחה"
    }
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
  };

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function getPublicFile(urlPath) {
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const decoded = decodeURIComponent(requested.split("?")[0]);
  const safePath = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  return filePath.startsWith(PUBLIC_DIR) ? filePath : null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/claim") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10000) req.destroy();
    });
    req.on("end", async () => {
      try {
        const result = await claimBenefit(JSON.parse(body || "{}"));
        sendJson(res, result.status, result.payload);
      } catch {
        sendJson(res, 400, { error: "bad_request" });
      }
    });
    return;
  }

  const filePath = getPublicFile(url.pathname);
  if (!filePath) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  sendFile(res, filePath);
});

ensureDataFiles();
server.listen(PORT, () => {
  console.log(`Restaurant benefit app is running at http://localhost:${PORT}`);
  console.log(`Excel-ready leads file: ${LEADS_FILE}`);
});
