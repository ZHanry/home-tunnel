import { Router } from "express";
import { z } from "zod";
import { transaction } from "../../db.js";
import { asyncHandler, audit } from "../../http.js";
import { config } from "../../config.js";
import { getPrefixPolicy, parsePrefixPolicy, setPrefixPolicy } from "../../subdomain-policy.js";
import { parseBody } from "../../validation.js";
import { adminGuard } from "./shared.js";

const router = Router();
const policySchema = z.enum(["off", "suggest", "enforce"]);

router.get(
  "/settings",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const policy = await transaction(async (client) => getPrefixPolicy(client));
    response.json({
      subdomain_prefix_policy: policy,
      default_subdomain_prefix_policy: config.subdomainPrefixPolicy,
    });
  }),
);

router.patch(
  "/settings",
  asyncHandler(async (request, response) => {
    const actor = adminGuard(request);
    const body = parseBody(z.object({ subdomain_prefix_policy: policySchema }), request.body);
    const policy = parsePrefixPolicy(body.subdomain_prefix_policy);
    await transaction(async (client) => {
      const before = await getPrefixPolicy(client);
      await setPrefixPolicy(client, policy);
      await audit(
        client,
        request,
        "DeploymentSettingsUpdated",
        "TrafficPolicy",
        actor.userId,
        { subdomain_prefix_policy: before },
        { subdomain_prefix_policy: policy },
      );
    });
    response.json({ subdomain_prefix_policy: policy });
  }),
);

export { router as settingsRouter };
