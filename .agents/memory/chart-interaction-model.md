---
name: Chart interaction model
description: Durable constraint for extending the TradeX Markets chart without changing its data or visual system.
---

The Markets chart is intentionally a custom SVG over genuine normalized BiQuote candles. Mouse and touch behavior should be implemented by extending that SVG's pointer model: drag the plot to pan, wheel over the plot to zoom around the cursor, drag the right axis to change visual price scale, drag the bottom axis to change horizontal density, and keep crosshair/OHLC overlays in the same coordinate system. Price ticks and time ticks must be regenerated from the current visible bars after every pan, zoom, timeframe change, or scale adjustment. The chart surface must suppress native text selection locally while leaving the rest of the page selectable.

**Why:** The product requires professional chart manipulation while explicitly prohibiting a Markets redesign, data fabrication, color changes, or unnecessary replacement of the existing chart.

**How to apply:** Preserve the existing Latest, Fit, Reset, indicator, drawing, alert, live quote, and responsive touch behavior. Treat zoom and vertical scaling as view state only; never alter candle values or request unsupported history. Keep axis hit zones separate from the plot body and derive labels from the same display coordinate transform used to render candles. Gate chart drags to the primary pointer button and use pointer capture so movement remains reliable outside the SVG.