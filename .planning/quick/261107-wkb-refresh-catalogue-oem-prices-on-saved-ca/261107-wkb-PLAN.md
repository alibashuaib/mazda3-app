---
quick_id: 261107-wkb
---
# Refresh catalogue OEM prices on saved cars at load

Saved garages keep the parts list from when the car was added, so the Mazda KSA dealer prices never reach them. Stamp `catPrice` on catalogue OEM options; in normalizeData refresh the OEM option of the 7 dealer-priced parts while it still holds a catalogue value (stamp match, or a historical catalogue price for legacy saves) and a Mazda Genuine brand. Owner-typed prices stay.
