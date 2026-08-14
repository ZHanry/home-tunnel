import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler, requireAdmin, requirePasswordNormal } from "../../http.js";

const router = Router();

router.get(
  "/audit-events",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const action = String(request.query.action ?? "")
      .trim()
      .slice(0, 128);
    const targetId = String(request.query.target_id ?? "")
      .trim()
      .slice(0, 256);
    const targetType = String(request.query.target_type ?? "")
      .trim()
      .slice(0, 64);
    const search = String(request.query.q ?? "")
      .trim()
      .slice(0, 160);
    const requestedPage = Math.min(
      1_000_000,
      Math.max(1, Number.parseInt(String(request.query.page ?? 1), 10) || 1),
    );
    const legacyLimit =
      request.query.limit == null ? null : Number.parseInt(String(request.query.limit), 10);
    const requestedPageSize =
      Number.parseInt(String(request.query.page_size ?? legacyLimit ?? 100), 10) || 100;
    const pageSize = Math.min(
      request.query.page_size == null ? 200 : 100,
      Math.max(1, requestedPageSize),
    );
    const filterSql = `
      WHERE (?='' OR action=?)
        AND (?='' OR target_id=?)
        AND (?='' OR target_type=?)
        AND (?='' OR action LIKE '%'||?||'%'
                    OR actor_type LIKE '%'||?||'%'
                    OR coalesce(actor_id,'') LIKE '%'||?||'%'
                    OR target_type LIKE '%'||?||'%'
                    OR coalesce(target_id,'') LIKE '%'||?||'%'
                    OR request_id LIKE '%'||?||'%')`;
    const filterValues = [
      action,
      action,
      targetId,
      targetId,
      targetType,
      targetType,
      search,
      search,
      search,
      search,
      search,
      search,
      search,
    ];
    const countRows = await query<{ total: string }>(
      `SELECT count(*) AS total FROM (SELECT id FROM audit_events ${filterSql} LIMIT 10001) capped`,
      filterValues,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const rows = await query(
      `SELECT id,actor_type,actor_id,action,target_type,target_id,before_value,after_value,
            request_id,source_ip,created_at
       FROM audit_events ${filterSql}
      ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...filterValues, pageSize, (page - 1) * pageSize],
    );
    response.json({ items: rows, total, page, page_size: pageSize, total_pages: totalPages });
  }),
);

router.get(
  "/traffic/summary",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const hours = Math.min(
      168,
      Math.max(1, Number.parseInt(String(request.query.hours ?? 24), 10) || 24),
    );
    const userId = String(request.query.user_id ?? "");
    const rows = await query<{
      user_id: string;
      connection_id: string;
      username: string;
      name: string;
      subdomain: string;
      upload_bytes: string;
      download_bytes: string;
      requests: string;
      errors: string;
    }>(
      `SELECT ts.user_id,ts.connection_id,u.username,c.name,c.subdomain,
            sum(ts.upload_bytes) AS upload_bytes,sum(ts.download_bytes) AS download_bytes,
            sum(ts.request_count) AS requests,sum(ts.error_count) AS errors
       FROM traffic_samples ts JOIN users u ON u.id=ts.user_id JOIN connections c ON c.id=ts.connection_id
      WHERE ts.bucket_start > home_tunnel_add_seconds(home_tunnel_now(), -3600 * ?) AND (?='' OR ts.user_id=?)
      GROUP BY ts.user_id,ts.connection_id,u.username,c.name,c.subdomain
      ORDER BY sum(ts.upload_bytes+ts.download_bytes) DESC LIMIT 200`,
      [hours, userId, userId],
    );
    response.json({
      hours,
      items: rows.map((row) => ({
        ...row,
        upload_bytes: Number(row.upload_bytes),
        download_bytes: Number(row.download_bytes),
        requests: Number(row.requests),
        errors: Number(row.errors),
      })),
    });
  }),
);

export { router as auditRouter };
