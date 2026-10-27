import fs from "node:fs";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { provider, addresses, manifest, clock } from "./chain.js";
import { notFound, errorHandler } from "./middleware.js";
import { pushEnabled } from "./notify.js";
import authRoutes from "./routes/auth.js";
import walletRoutes from "./routes/wallet.js";
import willRoutes from "./routes/wills.js";
import txRoutes from "./routes/tx.js";
import documentRoutes from "./routes/documents.js";
import notificationRoutes from "./routes/notifications.js";
import explorerRoutes from "./routes/explorer.js";
import adminRoutes from "./routes/admin.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null, // plain http://localhost
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: false, // served over plain http on localhost
    })
  );

  // CORS locked to the local front-end origins; same-origin and curl (no Origin) pass.
  app.use(
    cors({
      origin(origin, done) {
        done(null, !origin || config.corsOrigins.includes(origin));
      },
      exposedHeaders: ["Content-Disposition", "X-Document-SHA256"],
    })
  );

  app.use(express.json({ limit: "100kb" }));

  app.use(
    "/api",
    rateLimit({
      windowMs: 60 * 1000,
      limit: config.apiRateLimitMax,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests — slow down." },
    })
  );

  app.get("/api/health", async (_req, res) => {
    let blockNumber = null;
    try {
      blockNumber = await provider.getBlockNumber();
    } catch {
      /* reported below */
    }
    res.status(blockNumber === null ? 503 : 200).json({
      ok: blockNumber !== null,
      chain: { reachable: blockNumber !== null, blockNumber, chainId: manifest.chainId },
    });
  });

  /** Everything the browser needs to point MetaMask at the right chain. Public. */
  app.get("/api/chain/config", (_req, res) => {
    res.json({
      chainId: manifest.chainId,
      chainIdHex: `0x${manifest.chainId.toString(16)}`,
      rpcUrl: config.rpcUrl,
      contracts: addresses,
      chainNow: clock.now(),
      pushEnabled,
      demoTools: config.demoTools,
    });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/wallet", walletRoutes);
  app.use("/api/wills", willRoutes);
  app.use("/api/tx", txRoutes);
  app.use("/api/documents", documentRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/explorer", explorerRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api", notFound);

  // Production / demo mode: serve the built React app from the same origin.
  const indexHtml = path.join(config.frontendDist, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(
      express.static(config.frontendDist, {
        setHeaders(res, file) {
          // the service worker and the app shell must never be served stale
          if (/(sw\.js|index\.html|manifest\.webmanifest)$/.test(file)) res.setHeader("Cache-Control", "no-cache");
        },
      })
    );
    app.use((req, res, next) => {
      if (req.method !== "GET" || path.extname(req.path)) return next();
      res.setHeader("Cache-Control", "no-cache");
      // `root` keeps send's dotfile guard off the absolute path (e.g. a project under ~/.something)
      res.sendFile("index.html", { root: config.frontendDist });
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
