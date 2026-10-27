import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { db } from "../db.js";
import { manager, lower, checksum, STATUS } from "../chain.js";
import { HttpError, asInt, bad } from "../http.js";
import { requireAuth, requireWallet } from "../middleware.js";
import { party } from "../wills.js";
import { storeDocument, onChainAsset, verifyDocument, openDocument, deleteDocument, ALLOWED_EXTENSIONS } from "../documents.js";
import { storage } from "../storage/index.js";

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

const getDoc = (req) => {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(asInt(req.params.id, "id", { min: 1 }));
  if (!doc) throw new HttpError(404, "Document not found");
  return doc;
};

/** Who is asking, relative to this document — decided from LIVE chain state. */
async function accessFor(user, doc) {
  const wallet = user.wallet_address ? lower(user.wallet_address) : null;
  const asset = await onChainAsset(doc);
  const isOwner = wallet !== null && wallet === doc.owner_address;
  const isAssignee = Boolean(asset && wallet && lower(asset.assignedTo) === wallet && !asset.removed);
  let isExecutor = false;
  let activated = false;
  if (asset) {
    const will = await manager.wills(doc.owner_address);
    isExecutor = wallet !== null && lower(will.executor) === wallet;
    activated = will.activated;
  }

  let canDownload = false;
  let reason = "You are not a party to this document.";
  if (isOwner) {
    canDownload = true;
    reason = "You uploaded this document.";
  } else if (isAssignee) {
    // The rule from the design: a specific on-chain claim of THIS asset unlocks it.
    canDownload = asset.isClaimed;
    reason = asset.isClaimed
      ? "Your on-chain claim of this document is recorded."
      : activated
        ? "Claim this document on-chain first (Beneficiary dashboard → Claim this item)."
        : "Locked until the will is activated and you claim this document on-chain.";
  }
  return { asset, activated, isOwner, isAssignee, isExecutor, canDownload, reason, canSee: isOwner || isAssignee || isExecutor || user.role === "admin" };
}

function shape(doc, access) {
  const { asset } = access;
  return {
    id: doc.id,
    originalName: doc.original_name,
    mimeType: doc.mime_type,
    sizeBytes: doc.size_bytes,
    sha256: doc.sha256_hash,
    cid: doc.cid,
    storage: storage.name,
    uploadedAt: doc.uploaded_at.replace(" ", "T") + "Z",
    owner: party(doc.owner_address),
    onChain: asset
      ? {
          registered: true,
          assetIndex: asset.index,
          assignedTo: party(asset.assignedTo),
          isClaimed: asset.isClaimed,
          removed: asset.removed,
          willActivated: access.activated,
        }
      : { registered: false },
    role: access.isOwner ? "owner" : access.isAssignee ? "beneficiary" : access.isExecutor ? "executor" : "observer",
    canDownload: access.canDownload,
    accessReason: access.reason,
  };
}

router.get("/config", (_req, res) => {
  res.json({ maxBytes: config.maxUploadBytes, extensions: ALLOWED_EXTENSIONS, storage: storage.name });
});

/** Documents I uploaded + documents assigned to me in someone else's will. */
router.get("/", requireWallet, async (req, res) => {
  const wallet = lower(req.user.wallet_address);
  const mine = db.prepare("SELECT * FROM documents WHERE owner_address = ? ORDER BY id DESC").all(wallet);
  const assigned = db
    .prepare(
      `SELECT d.* FROM documents d
         JOIN assets_cache a ON a.will_id = d.owner_address AND a.asset_index = d.asset_index
        WHERE a.asset_type = 'DOCUMENT' AND a.assigned_to = ? AND a.removed = 0 AND d.owner_address != ?
        ORDER BY d.id DESC`
    )
    .all(wallet, wallet);

  const describe = async (doc) => shape(doc, await accessFor(req.user, doc));
  const inherited = (await Promise.all(assigned.map(describe))).filter((d) => d.role === "beneficiary");
  res.json({ owned: await Promise.all(mine.map(describe)), inherited });
});

router.post("/", requireWallet, upload.single("file"), async (req, res) => {
  if (!req.file) throw bad('No file uploaded (multipart field "file")');
  const doc = await storeDocument({ user: req.user, originalName: req.file.originalname, buffer: req.file.buffer });
  res.status(201).json({ document: shape(doc, await accessFor(req.user, doc)) });
});

router.post("/:id/verify", async (req, res) => {
  const doc = getDoc(req);
  const access = await accessFor(req.user, doc);
  if (!access.canSee) throw new HttpError(403, "You are not a party to this document");
  const verdict = await verifyDocument(doc, access.asset);
  res.json({ document: shape(doc, access), ...verdict });
});

router.get("/:id/download", async (req, res) => {
  const doc = getDoc(req);
  const access = await accessFor(req.user, doc);
  if (!access.canDownload) throw new HttpError(403, access.reason);

  const { verdict, plain } = await openDocument(doc, access.asset);
  if (!plain) throw new HttpError(409, `Integrity check failed — refusing to serve this file. ${verdict.problem}`, { verdict });

  res.set({
    "Content-Type": doc.mime_type,
    "Content-Length": String(plain.length),
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`,
    "X-Content-Type-Options": "nosniff",
    "X-Document-SHA256": verdict.actual.sha256,
    "Cache-Control": "no-store",
  });
  res.send(plain);
});

/** Only files that are not (or no longer) part of a live will can be deleted. */
router.delete("/:id", requireWallet, async (req, res) => {
  const doc = getDoc(req);
  if (doc.owner_address !== lower(req.user.wallet_address)) throw new HttpError(403, "Only the uploader can delete a document");
  const asset = await onChainAsset(doc);
  if (asset && !asset.removed) {
    const status = STATUS[Number(await manager.getStatus(checksum(doc.owner_address)))];
    if (status !== "REVOKED") {
      throw new HttpError(409, "This document is registered in your will. Remove the asset from the will first.");
    }
  }
  await deleteDocument(doc);
  res.json({ ok: true });
});

export default router;
