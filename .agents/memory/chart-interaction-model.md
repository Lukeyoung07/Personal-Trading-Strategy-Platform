---
name: Chart interaction model
description: Durable constraint for extending the TradeX Markets chart without changing its data or visual system.
---

The Markets chart is intentionally a custom SVG over genuine normalized BiQuote candles. Mouse and touch behavior should be implemented by extending that SVG's pointer model: drag the plot to pan, wheel over the plot to zoom around the cursor, drag the right axis to change visual price scale, drag the bottom axis to change horizontal density, and keep crosshair/OHLC overlays in the same coordinate system.

**Why:** The product requires professional chart manipulation while explicitly prohibiting a Markets redesign, data fabrication, color changes, or unnecessary replacement of the existing chart.

**How to apply:** Preserve the existing Latest, Fit, Reset, indicator, drawing, alert, live quote, and responsive touch behavior. Treat zoom and vertical scaling as view state only; never alter candle values or request unsupported history.