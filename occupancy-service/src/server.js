import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Redis } from "@upstash/redis";
import { jwtVerify } from "jose";
import { nearestVenueForOccupancy } from "./venues.js";

const COUNTS_HASH = "occ:counts";

function redisUserKey(userId) {
  return `occ:assign:${userId}`;
}

function validUserId(fromJwt, allowedAnonFallback, rawDeviceId) {
  if (fromJwt && typeof fromJwt === "string" && fromJwt.length > 0 && fromJwt.length <= 200) {
    return fromJwt;
  }
  const allow =
    allowedAnonFallback &&
    typeof rawDeviceId === "string" &&
    /^anon_[a-zA-Z0-9_-]{8,128}$/.test(rawDeviceId);
  return allow ? rawDeviceId : null;
}

async function resolveUser(req, jwtSecretRaw, allowAnon) {
  const auth = req.headers.authorization;
  let sub = null;
  if (auth?.startsWith("Bearer ") && jwtSecretRaw) {
    const token = auth.slice(7);
    try {
      const secret = new TextEncoder().encode(jwtSecretRaw);
      const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
      sub = payload.sub ?? null;
    } catch {
      sub = null;
    }
  }
  const raw =
    typeof req.body === "object" && req.body !== null ? req.body.deviceUserId : undefined;
  return validUserId(sub, allowAnon, raw);
}

async function assignVenue(redis, userId, venueNameOrNull) {
  const key = redisUserKey(userId);
  const newV = venueNameOrNull ?? "";
  const LUA = `
    local uk = KEYS[1]
    local ch = KEYS[2]
    local newv = ARGV[1]
    local ttl = tonumber(ARGV[2]) or 180
    local prev = redis.call("GET", uk)
    if prev == false then prev = "" end

    if newv == prev then
      if newv ~= "" then
        redis.call("SET", uk, newv, "EX", ttl)
      end
      return 1
    end

    if prev ~= "" then
      local n = tonumber(redis.call("HGET", ch, prev) or "0")
      local nextn = math.max(0, n - 1)
      if nextn <= 0 then
        redis.call("HDEL", ch, prev)
      else
        redis.call("HSET", ch, prev, nextn)
      end
    end

    if newv ~= "" then
      redis.call("SET", uk, newv, "EX", ttl)
      redis.call("HINCRBY", ch, newv, 1)
    else
      redis.call("DEL", uk)
    end
    return 1
  `;
  await redis.eval(LUA, [key, COUNTS_HASH], [newV, "180"]);
}

async function leaveUser(redis, userId) {
  await assignVenue(redis, userId, null);
}

export async function buildApp() {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const jwtSecret = process.env.SUPABASE_JWT_SECRET ?? "";
  const allowAnon = /^1|true$/i.test(process.env.OCCUPANCY_ALLOW_ANON_DEVICE_ID ?? "true");

  if (!redisUrl || !redisToken) {
    throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.");
  }

  const redis = new Redis({ url: redisUrl, token: redisToken });
  const fastify = Fastify({ logger: true });
  await fastify.register(cors, { origin: true });

  fastify.get("/health", async () => ({ ok: true }));

  fastify.get("/counts", async () => {
    const all = await redis.hgetall(COUNTS_HASH);
    const counts = {};
    if (all) {
      for (const [k, v] of Object.entries(all)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) counts[k] = n;
      }
    }
    return { counts };
  });

  fastify.post("/heartbeat", async (request, reply) => {
    const body = request.body ?? {};
    const lat = Number(body.latitude);
    const lon = Number(body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return reply.code(400).send({ error: "latitude and longitude required" });
    }
    const userId = await resolveUser(request, jwtSecret, allowAnon);
    if (!userId) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const venue = nearestVenueForOccupancy(lat, lon);
    await assignVenue(redis, userId, venue);
    return {
      venue: venue ?? "",
    };
  });

  fastify.post("/leave", async (request, reply) => {
    const userId = await resolveUser(request, jwtSecret, allowAnon);
    if (!userId) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    await leaveUser(redis, userId);
    return { ok: true };
  });

  return fastify;
}

const PORT = Number(process.env.PORT ?? 8787);

buildApp()
  .then((app) =>
    app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
      console.log(`[occupancy] listening on ${PORT}`);
    })
  )
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
