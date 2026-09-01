-- ===========================================================================
-- releaseStock.lua  —  return a previously held quantity to availability.
--
-- Used by the BullMQ expiry worker (auto-reclamation) and by patient-initiated
-- cancellations. "held" is floored at 0 so a double-release can never push the
-- counter negative.
--
-- KEYS[1] : stock hash key
-- ARGV[1] : quantity to release (positive integer)
--
-- Return values:
--    >= 0  -> the NEW value of "held"
--    -1    -> stock key is missing
--    -3    -> invalid quantity
-- ===========================================================================

local key = KEYS[1]
local qty = tonumber(ARGV[1])

if qty == nil or qty <= 0 then
  return -3
end

if redis.call("EXISTS", key) == 0 then
  return -1
end

local held    = tonumber(redis.call("HGET", key, "held")) or 0
local newHeld = held - qty
if newHeld < 0 then
  newHeld = 0
end

redis.call("HSET", key, "held", newHeld)
return newHeld
