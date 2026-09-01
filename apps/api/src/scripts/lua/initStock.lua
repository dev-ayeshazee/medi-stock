-- ===========================================================================
-- initStock.lua  —  seed the Redis stock hash from the Postgres source of
-- truth, but ONLY if it does not already exist.
--
-- Race-safe: if two callers seed concurrently they write identical values, and
-- an existing key (which may carry live holds) is never clobbered.
--
-- KEYS[1] : stock hash key
-- ARGV[1] : total stock (integer)
-- ARGV[2] : held stock  (integer)
--
-- Return: 1 if the key was created, 0 if it already existed.
-- ===========================================================================

local key = KEYS[1]

if redis.call("EXISTS", key) == 1 then
  return 0
end

local total = tonumber(ARGV[1]) or 0
local held  = tonumber(ARGV[2]) or 0

redis.call("HSET", key, "total", total, "held", held)
return 1
