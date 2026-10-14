require("dotenv").config();

const express = require("express");
const path = require("path");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "messfinder";

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set. Add it to .env (local) or to Render's Environment settings.");
  process.exit(1);
}

const app = express();

// Photos are saved as data URLs, so allow a larger body than the default.
app.use(express.json({ limit: "15mb" }));

let messes; // MongoDB collection

/* ---------- helpers ---------- */

// Same key rule the site already uses: email with "." and "@" turned into "_"
function keyOf(email) {
  return String(email || "").replace(/[.@]/g, "_");
}

const FIELDS = [
  "name", "location", "price", "type",
  "ownerEmail", "ownerPassword",
  "menu", "photo", "contactNumber",
  "whatsappLink", "mapLink",
  "openTime", "closeTime"
];

// The pages insert these values with innerHTML, so neutralise tags on the way in.
function clean(value) {
  return String(value ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cleanLink(value) {
  const v = String(value ?? "").trim();
  return /^https?:\/\//i.test(v) ? v : "";
}

function cleanPhoto(value) {
  const v = String(value ?? "");
  return /^data:image\/[a-z+.-]+;base64,/i.test(v) || /^https?:\/\//i.test(v) ? v : "";
}

function cleanReviews(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 200).map(r => ({
    rating: Number(r && r.rating) || 0,
    comment: clean(r && r.comment)
  }));
}

function buildDoc(body) {
  const doc = {};
  for (const f of FIELDS) doc[f] = clean(body[f]);
  doc.whatsappLink = cleanLink(body.whatsappLink);
  doc.mapLink = cleanLink(body.mapLink);
  doc.photo = cleanPhoto(body.photo);
  doc.reviews = cleanReviews(body.reviews);
  return doc;
}

function publicView(doc) {
  const { ownerPassword, ownerEmail, ...rest } = doc;
  return rest;
}

// Create a new mess, or update an existing one when the owner password matches.
async function save(key, body, res) {
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid data" });
  }

  const doc = buildDoc(body);

  if (!doc.ownerEmail || !doc.ownerPassword) {
    return res.status(400).json({ error: "Owner email and password are required" });
  }
  if (keyOf(doc.ownerEmail) !== key) {
    return res.status(400).json({ error: "Email does not match this account" });
  }

  const existing = await messes.findOne({ _id: key });

  if (existing && existing.ownerPassword !== doc.ownerPassword) {
    return res.status(403).json({ error: "An account with this email already exists" });
  }

  await messes.replaceOne({ _id: key }, { _id: key, ...doc }, { upsert: true });
  res.json({ ok: true });
}

/* ---------- API ---------- */

app.get("/api/health", (req, res) => res.json({ ok: true }));

// All messes (no passwords or owner emails), keyed by id
app.get("/api/messes", async (req, res, next) => {
  try {
    const all = await messes.find({}).toArray();
    const out = {};
    for (const d of all) out[d._id] = publicView(d);
    res.json(out);
  } catch (e) { next(e); }
});

// One mess by key (used by the owner login pages)
app.get("/api/messes/:key", async (req, res, next) => {
  try {
    const doc = await messes.findOne({ _id: req.params.key });
    if (!doc) return res.status(404).json(null);
    res.json(doc);
  } catch (e) { next(e); }
});

// Register / update (used by owner registration)
app.put("/api/messes/:key", async (req, res, next) => {
  try { await save(req.params.key, req.body, res); } catch (e) { next(e); }
});

// Save details (used by the owner dashboard)
app.post("/api/messes", async (req, res, next) => {
  try { await save(keyOf(req.body && req.body.ownerEmail), req.body, res); } catch (e) { next(e); }
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

/* ---------- website ---------- */

app.use(express.static(path.join(__dirname, "public")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

/* ---------- start ---------- */

async function start() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  messes = client.db(DB_NAME).collection("messes");
  app.listen(PORT, () => console.log("Mess Finder running on port " + PORT));
}

if (require.main === module) {
  start().catch(err => {
    console.error("Could not start:", err.message);
    process.exit(1);
  });
}

module.exports = { app, start, _setCollection: c => { messes = c; } };
