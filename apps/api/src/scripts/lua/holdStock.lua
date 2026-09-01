-- ===========================================================================
-- holdStock.lua  —  atomically reserve inventory without overselling.
--
-- Redis executes each script body atomically: no other command can interleave
-- between the availability check and the increment, which is exactly the
-- guarantee a naive GET-then-SET in application code cannot provide.
--
-- KEYS[1] : stock hash key           e.g. medistock:stock:<inventoryId>
--           hash fields:
--             "total" -> physical shelf count (integer)
--             "held"  -> quantity under active holds (integer)
-- ARGV[1] : requested quantity       (positive integer)
--
-- Return values:
--    >= 0  success  -> the NEW value of "held" after the reservation
--    -1            -> stock key is missing (caller must seed it from Postgres)
--    -2            -> insufficient available stock: (total - held) < requested
--    -3            -> invalid requested quantity
-- ===========================================================================

local key       = KEYS[1]
local requested = tonumber(ARGV[1])

if requested == nil or requested <= 0 then
  return -3
end

if redis.call("EXISTS", key) == 0 then
  return -1
end

local total = tonumber(redis.call("HGET", key, "total")) or 0
local held  = tonumber(redis.call("HGET", key, "held"))  or 0

if (total - held) < requested then
  return -2
end

local newHeld = redis.call("HINCRBY", key, "held", requested)
return newHeld
