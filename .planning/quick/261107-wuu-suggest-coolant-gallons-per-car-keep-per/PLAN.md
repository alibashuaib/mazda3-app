---
quick_id: 261107-wuu
description: Suggest coolant gallons per car, keep per-gallon price
---

In `coolantPart`, compute gal = ceil(liters / 3.785) and add "Buy N gal (1 gal = 3.78 L); price is per gallon..." to the OEM note. Price stays 78.2 per gallon. Extend the Arabic patterns with {2}. normalizeData rebuilds saved coolant parts whose note lacks the gallon count.
