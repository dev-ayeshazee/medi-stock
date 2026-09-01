-- ===========================================================================
-- commitStock.lua  —  permanently consume a held quantity on fulfilment.
--
-- Called when a pharmacist claims a reservation. Decrements BOTH "total" and
-- "held" by the same amount, so availability (total - held) is unchanged while
-- the physical shelf count drops. Both fields are floored at 0.
--
-- KEYS[1] : stock hash key
-- ARGV[1] : quantity to commit (positive integer)
--
-- Return: { newTotal, newHeld }
--   { -1, -1 } -> stock key is missing
--   { -3, -3 } -> invalid quantity
-- ===========================================================================

local key = KEYS[1]
local qty = tonumber(ARGV[1])

if qty == nil or qty <= 0 then
  return { -3, -3 }
end

if redis.call("EXISTS", key) == 0 then
  return { -1, -1 }
end

local total = tonumber(redis.call("HGET", key, "total")) or 0
local held  = tonumber(redis.call("HGET", key, "held"))  or 0

local newTotal = total - qty
if newTotal < 0 then newTotal = 0 end

local newHeld = held - qty
if newHeld < 0 then newHeld = 0 end

redis.call("HSET", key, "total", newTotal, "held", newHeld)
return { newTotal, newHeld }
