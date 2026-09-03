import { Router } from "express";
import { auditRouter } from "./admin/audit.js";
import { connectionsRouter } from "./admin/connections.js";
import { devicesRouter } from "./admin/devices.js";
import { healthRouter } from "./admin/health.js";
import { settingsRouter } from "./admin/settings.js";
import { usersRouter } from "./admin/users.js";

// Preserve the historical mount point and route paths while keeping each
// management concern independently testable and reviewable.
const router = Router();
router.use(healthRouter);
router.use(usersRouter);
router.use(devicesRouter);
router.use(connectionsRouter);
router.use(auditRouter);
router.use(settingsRouter);

export { router as adminRouter };
