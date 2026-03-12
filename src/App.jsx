import { useState, useCallback, useEffect } from "react";

const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const STYLES = [
  { id: "athleisure", label: "Athleisure", example: "joggers, sneakers, zip-up" },
  { id: "casual", label: "Casual", example: "jeans, t-shirt, clean sneakers" },
  { id: "business", label: "Business", example: "chinos, button-down, loafers" },
  { id: "formal", label: "Formal", example: "suit, dress, structured separates" },
];

const EXPOSURE_LABELS = [
  "Barely outside",
  "Short bursts",
  "30–45 min",
  "1–2 hours",
  "Most of the day",
];

const labelStyle = {
  display: "block", color: "#6a9ab8", fontSize: "11px",
  letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "10px",
};

const inputStyle = {
  width: "100%", padding: "11px 13px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "3px", color: "#e8f4f8",
  fontSize: "14px", fontFamily: "'Georgia', serif",
  transition: "border-color 0.2s",
};

const chipStyle = (active) => ({
  padding: "8px 12px",
  background: active ? "rgba(100,180,255,0.15)" : "rgba(255,255,255,0.04)",
  border: `1px solid ${active ? "rgba(100,180,255,0.5)" : "rgba(255,255,255,0.09)"}`,
  color: active ? "#a8d8f0" : "#5a8a9a",
  borderRadius: "3px", fontSize: "12px", cursor: "pointer",
  fontFamily: "'Georgia', serif", transition: "all 0.15s",
  whiteSpace: "nowrap",
});

const WEATHER_EMOJI = {
  Thunderstorm: "⛈️", Drizzle: "🌦️", Rain: "🌧️", Snow: "❄️",
  Mist: "🌫️", Smoke: "🌫️", Haze: "🌫️", Dust: "🌫️", Fog: "🌫️",
  Sand: "🌫️", Ash: "🌫️", Squall: "🌬️", Tornado: "🌪️",
  Clear: "☀️", Clouds: "☁️",
};

async function fetchWeather(locationInput) {
  const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY;
  const isZip = /^\d{5}$/.test(locationInput.trim());
  const query = isZip
    ? `zip=${locationInput.trim()},US&units=imperial`
    : `q=${encodeURIComponent(locationInput)}&units=imperial`;
  const url = `https://api.openweathermap.org/data/2.5/weather?${query}&appid=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not find that location. Try a city name or zip code.");
  const data = await res.json();
  return {
    tempF: Math.round(data.main.temp),
    feelsLikeF: Math.round(data.main.feels_like),
    conditions: data.weather[0].description.charAt(0).toUpperCase() + data.weather[0].description.slice(1),
    emoji: WEATHER_EMOJI[data.weather[0].main] || "🌡️",
    windMph: Math.round(data.wind.speed),
    humidity: data.main.humidity,
    uvIndex: "—",
    locationDisplay: `${data.name}, ${data.sys.country}`,
  };
}

async function fetchRecommendation({ weather, heatTolerance, dressStyle, style, exposureIndex, feedbackHistory }) {
  const historyNote = feedbackHistory.length > 0
    ? `Past outfit feedback: ${feedbackHistory.map(h => `felt ${h.feeling} (${h.style} style, exposure: ${EXPOSURE_LABELS[h.exposureIndex]})`).join("; ")}.`
    : "";

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });

  const styleObj = STYLES.find(s => s.id === style);
  const exposureLabel = EXPOSURE_LABELS[exposureIndex];

  const prompt = `Today is ${today}.

Current weather conditions:
- Temperature: ${weather.tempF}°F (feels like ${weather.feelsLikeF}°F)
- Conditions: ${weather.conditions}
- Wind: ${weather.windMph} mph
- Humidity: ${weather.humidity}%
- Location: ${weather.locationDisplay}

User profile:
- Clothing style: ${dressStyle === "menswear" ? "menswear (tailored, structured, traditionally masculine cuts)" : dressStyle === "womenswear" ? "womenswear (dresses, skirts, feminine silhouettes welcome)" : "gender-fluid / mix of both — use inclusive clothing language"}
- Style register today: ${styleObj.label} (e.g. ${styleObj.example})
- Time outside today (excluding exercise/strenuous activity): ${exposureLabel}
${historyNote}

The outdoor exposure time should significantly affect layering and practicality advice. Someone barely outside needs comfort; someone outside most of the day needs durability and weather protection.

Respond ONLY with a raw JSON object. No markdown. No backticks. No explanation. Just valid JSON:
{"headline":"A sharp layered look that handles the cold without bulk","layers":["Thermal base layer under a fitted crewneck","Dark slim chinos","Structured wool overcoat"],"keyAdvice":"Wind makes it feel 5 degrees colder than it is — the coat earns its place today.","watchOut":"Rain possible after 3pm — consider a coat with some water resistance."}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  const raw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  const cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Unexpected response: ${raw.slice(0, 150)}`);
  return JSON.parse(match[0]);
}

export default function Wearther() {
  const [step, setStep] = useState("profile");
  const [profile, setProfile] = useState({
   name: "", locationInput: "", heatTolerance: "average", dressStyle: "menswear",
  });

  const [activeStyle, setActiveStyle] = useState("casual");
  const [exposureIndex, setExposureIndex] = useState(1);
  const [weather, setWeather] = useState(null);
  const [rec, setRec] = useState(null);
  const [recLoading, setRecLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [feedbackHistory, setFeedbackHistory] = useState([]);
  const [error, setError] = useState(null);
  const [locationDetected, setLocationDetected] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);

  const canSubmit = profile.name.trim() && profile.locationInput.trim();

  useEffect(() => {
    if (!navigator.geolocation) return;
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY;
          const res = await fetch(
            `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${apiKey}`
          );
          const data = await res.json();
          const cityName = `${data.name}, ${data.sys.country}`;
          setProfile(p => ({ ...p, locationInput: p.locationInput || cityName }));
          setLocationDetected(true);
        } catch {}
        finally { setLocationLoading(false); }
      },
      () => setLocationLoading(false),
      { timeout: 5000 }
    );
  }, []);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setStep("loading");
    setError(null);
    try {
      const weatherData = await fetchWeather(profile.locationInput);
      setWeather(weatherData);
      const recData = await fetchRecommendation({
        weather: weatherData,
        heatTolerance: profile.heatTolerance,\n        dressStyle: profile.dressStyle,\n        dressStyle: profile.dressStyle,
        style: activeStyle,
        exposureIndex,
        feedbackHistory,
      });
      setRec({ ...weatherData, ...recData });
      setStep("recommendation");
    } catch (e) {
      setError(e.message);
      setStep("profile");
    }
  };

  const handleStyleChange = async (newStyle) => {
    setActiveStyle(newStyle);
    setRecLoading(true);
    try {
      const recData = await fetchRecommendation({
        weather,
        heatTolerance: profile.heatTolerance,\n        dressStyle: profile.dressStyle,\n        dressStyle: profile.dressStyle,
        style: newStyle,
        exposureIndex,
        feedbackHistory,
      });
      setRec(r => ({ ...r, ...recData }));
    } catch (e) {
      setError(e.message);
    } finally {
      setRecLoading(false);
    }
  };

  const handleExposureChange = async (newIndex) => {
    setExposureIndex(newIndex);
    setRecLoading(true);
    try {
      const recData = await fetchRecommendation({
        weather,
        heatTolerance: profile.heatTolerance,\n        dressStyle: profile.dressStyle,\n        dressStyle: profile.dressStyle,
        style: activeStyle,
        exposureIndex: newIndex,
        feedbackHistory,
      });
      setRec(r => ({ ...r, ...recData }));
    } catch (e) {
      setError(e.message);
    } finally {
      setRecLoading(false);
    }
  };

  const handleFeedback = (feeling) => {
    const updated = [...feedbackHistory, {
      feeling, style: activeStyle,
      exposureIndex, date: new Date().toLocaleDateString()
    }];
    setFeedback(feeling);
    setFeedbackHistory(updated);
    setStep("feedback");
  };

  const handleRefresh = async () => {
    setStep("loading");
    try {
      const weatherData = await fetchWeather(profile.locationInput);
      setWeather(weatherData);
      const recData = await fetchRecommendation({
        weather: weatherData,
        heatTolerance: profile.heatTolerance,\n        dressStyle: profile.dressStyle,\n        dressStyle: profile.dressStyle,
        style: activeStyle,
        exposureIndex,
        feedbackHistory,
      });
      setRec({ ...weatherData, ...recData });
      setFeedback(null);
      setStep("recommendation");
    } catch (e) {
      setError(e.message);
      setStep("profile");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(145deg, #0f1923 0%, #1a2a3a 50%, #0d1f2d 100%)",
      fontFamily: "'Georgia', 'Times New Roman', serif",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "20px",
    }}>
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 20% 20%, rgba(100,180,255,0.06) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(255,200,100,0.04) 0%, transparent 60%)",
      }} />

      <div style={{ marginBottom: "28px", textAlign: "center" }}>
        <div style={{ fontSize: "11px", letterSpacing: "0.35em", color: "#6a9ab8", textTransform: "uppercase", marginBottom: "6px" }}>WEARTHER</div>
        <div style={{ width: "40px", height: "1px", background: "rgba(106,154,184,0.4)", margin: "0 auto" }} />
      </div>

      <div style={{
        width: "100%", maxWidth: "440px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: "4px", padding: "32px 28px",
        backdropFilter: "blur(12px)",
      }}>

        {step === "profile" && (
          <div>
            <h1 style={{ color: "#e8f4f8", fontSize: "20px", fontWeight: "normal", marginBottom: "6px", lineHeight: 1.4 }}>
              Dress for the weather you're in,<br />not the forecast you read.
            </h1>
            <p style={{ color: "#6a9ab8", fontSize: "13px", marginBottom: "28px", fontStyle: "italic" }}>
              A few questions to get started.
            </p>

            {error && (
              <div style={{ background: "rgba(255,100,100,0.1)", border: "1px solid rgba(255,100,100,0.3)", borderRadius: "3px", padding: "12px", marginBottom: "20px", color: "#ff9999", fontSize: "12px", wordBreak: "break-word" }}>
                {error}
              </div>
            )}

            <div style={{ marginBottom: "18px" }}>
              <label style={labelStyle}>What should we call you?</label>
              <input type="text" placeholder="First name" value={profile.name}
                onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                style={inputStyle} />
            </div>

            <div style={{ marginBottom: "18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Where are you?</label>
                {locationLoading && <span style={{ color: "#3a5a6a", fontSize: "10px", fontStyle: "italic" }}>Detecting…</span>}
                {locationDetected && !locationLoading && <span style={{ color: "#4a9a6a", fontSize: "10px", fontStyle: "italic" }}>📍 Detected — edit if needed</span>}
              </div>
              <input type="text" placeholder="e.g. Forest Hills, NY"
                value={profile.locationInput}
                onChange={e => { setLocationDetected(false); setProfile(p => ({ ...p, locationInput: e.target.value })); }}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                style={inputStyle} />
            </div>

            <div style={{ marginBottom: "28px" }}>
              <label style={labelStyle}>How do you run, temperature-wise?</label>
              <div style={{ display: "flex", gap: "8px" }}>
                {[["cold", "I run cold"], ["average", "Average"], ["hot", "I run warm"]].map(([val, label]) => (
                  <button key={val} onClick={() => setProfile(p => ({ ...p, heatTolerance: val }))}
                    style={chipStyle(profile.heatTolerance === val)}>{label}</button>
                ))}
              </div>
            </div>
<div style={{ marginBottom: "28px" }}>
  <label style={labelStyle}>How would you describe your style?</label>
  <div style={{ display: "flex", gap: "8px" }}>
    {[
      ["menswear", "Menswear", "Tailored, structured, traditionally masculine cuts"],
      ["womenswear", "Womenswear", "Dresses, skirts, feminine silhouettes welcome"],
      ["mixitup", "Mix it up", "Androgynous, gender-fluid, or just whatever fits"],
    ].map(([val, label, example]) => (
      <button key={val} onClick={() => setProfile(p => ({ ...p, dressStyle: val }))}
        title={example}
        style={{ ...chipStyle(profile.dressStyle === val), flex: 1, fontSize: "11px" }}>
        {label}
      </button>
    ))}
  </div>
  <div style={{ color: "#3a5a6a", fontSize: "11px", fontStyle: "italic", marginTop: "6px" }}>
    {[["menswear","Tailored, structured, traditionally masculine cuts"],["womenswear","Dresses, skirts, feminine silhouettes welcome"],["mixitup","Androgynous, gender-fluid, or just whatever fits"]].find(([v]) => v === profile.dressStyle)?.[1]}
  </div>
</div>
            <button onClick={handleSubmit} disabled={!canSubmit} style={{
              width: "100%", padding: "14px",
              background: canSubmit ? "rgba(100,180,255,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${canSubmit ? "rgba(100,180,255,0.5)" : "rgba(255,255,255,0.1)"}`,
              color: canSubmit ? "#a8d8f0" : "#4a6a7a",
              borderRadius: "3px", fontSize: "13px", letterSpacing: "0.15em",
              textTransform: "uppercase", cursor: canSubmit ? "pointer" : "default",
              fontFamily: "'Georgia', serif", transition: "all 0.2s",
            }}>
              Get my recommendation →
            </button>
          </div>
        )}

        {step === "loading" && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: "40px", marginBottom: "16px", animation: "pulse 1.5s ease-in-out infinite" }}>🌡️</div>
            <p style={{ color: "#6a9ab8", fontSize: "14px", fontStyle: "italic" }}>Reading conditions outside…</p>
            <p style={{ color: "#3a5a6a", fontSize: "12px", marginTop: "8px" }}>Building your recommendation</p>
          </div>
        )}

        {step === "recommendation" && rec && (
          <div>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: "20px", paddingBottom: "18px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
            }}>
              <div>
                <div style={{ color: "#6a9ab8", fontSize: "10px", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "4px" }}>
                  {rec.locationDisplay} · {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </div>
                <div style={{ color: "#e8f4f8", fontSize: "26px" }}>{rec.tempF}°F</div>
                <div style={{ color: "#8ab8cc", fontSize: "12px", fontStyle: "italic" }}>
                  Feels like {rec.feelsLikeF}°F · {rec.conditions}
                </div>
              </div>
              <div style={{ fontSize: "40px" }}>{rec.emoji}</div>
            </div>

            <div style={{ display: "flex", gap: "8px", marginBottom: "22px" }}>
              {[["Wind", `${rec.windMph} mph`], ["Humidity", `${rec.humidity}%`], ["UV", rec.uvIndex]].map(([label, val]) => (
                <div key={label} style={{
                  flex: 1, background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: "3px", padding: "8px", textAlign: "center",
                }}>
                  <div style={{ color: "#4a7a8a", fontSize: "9px", letterSpacing: "0.15em", textTransform: "uppercase" }}>{label}</div>
                  <div style={{ color: "#a8d0e0", fontSize: "13px", marginTop: "2px" }}>{val}</div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: "22px" }}>
              <div style={{ color: "#6a9ab8", fontSize: "10px", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "10px" }}>Style</div>
              <div style={{ display: "flex", gap: "6px" }}>
                {STYLES.map(s => (
                  <button key={s.id} onClick={() => handleStyleChange(s.id)} disabled={recLoading}
                    style={{
                      flex: 1, padding: "8px 4px",
                      background: activeStyle === s.id ? "rgba(100,180,255,0.15)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${activeStyle === s.id ? "rgba(100,180,255,0.5)" : "rgba(255,255,255,0.08)"}`,
                      color: activeStyle === s.id ? "#a8d8f0" : "#5a8a9a",
                      borderRadius: "3px", fontSize: "11px", cursor: recLoading ? "default" : "pointer",
                      fontFamily: "'Georgia', serif", transition: "all 0.15s",
                      opacity: recLoading ? 0.5 : 1,
                    }}>{s.label}</button>
                ))}
              </div>
              <div style={{ color: "#3a5a6a", fontSize: "11px", fontStyle: "italic", marginTop: "6px" }}>
                {STYLES.find(s => s.id === activeStyle)?.example}
              </div>
            </div>

            <div style={{ marginBottom: "22px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                <div style={{ color: "#6a9ab8", fontSize: "10px", letterSpacing: "0.2em", textTransform: "uppercase" }}>Time outside today</div>
                <div style={{ color: "#a8d8f0", fontSize: "12px", fontStyle: "italic" }}>{EXPOSURE_LABELS[exposureIndex]}</div>
              </div>
              <input type="range" min="0" max="4" step="1" value={exposureIndex}
                onChange={e => setExposureIndex(Number(e.target.value))}
                onMouseUp={e => handleExposureChange(Number(e.target.value))}
                onTouchEnd={e => handleExposureChange(Number(e.target.value))}
                disabled={recLoading}
                style={{
                  width: "100%", height: "2px", appearance: "none", WebkitAppearance: "none",
                  background: `linear-gradient(to right, rgba(100,180,255,0.6) 0%, rgba(100,180,255,0.6) ${exposureIndex * 25}%, rgba(255,255,255,0.1) ${exposureIndex * 25}%, rgba(255,255,255,0.1) 100%)`,
                  outline: "none", cursor: recLoading ? "default" : "pointer", opacity: recLoading ? 0.5 : 1,
                }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
                <span style={{ color: "#3a5a6a", fontSize: "10px" }}>Barely outside</span>
                <span style={{ color: "#3a5a6a", fontSize: "10px" }}>Most of the day</span>
              </div>
              <div style={{ color: "#3a5a6a", fontSize: "10px", fontStyle: "italic", marginTop: "4px" }}>Excluding exercise or strenuous activity</div>
            </div>

            {recLoading && (
              <div style={{ textAlign: "center", padding: "12px 0", marginBottom: "12px" }}>
                <span style={{ color: "#6a9ab8", fontSize: "12px", fontStyle: "italic", animation: "pulse 1s ease-in-out infinite" }}>Updating recommendation…</span>
              </div>
            )}

            {!recLoading && (
              <>
                <div style={{ marginBottom: "18px" }}>
                  <div style={{ color: "#6a9ab8", fontSize: "10px", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "8px" }}>Today's recommendation</div>
                  <p style={{ color: "#e8f4f8", fontSize: "17px", lineHeight: 1.4, fontWeight: "normal", margin: 0, fontStyle: "italic" }}>
                    "{rec.headline}"
                  </p>
                </div>

                <div style={{ marginBottom: "18px" }}>
                  <div style={{ color: "#6a9ab8", fontSize: "10px", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "10px" }}>What to wear</div>
                  {(rec.layers || []).map((layer, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: "10px", padding: "9px 0",
                      borderBottom: i < rec.layers.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                    }}>
                      <div style={{
                        width: "18px", height: "18px", borderRadius: "50%",
                        background: "rgba(100,180,255,0.1)", border: "1px solid rgba(100,180,255,0.3)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "9px", color: "#6ab0d0", flexShrink: 0,
                      }}>{i + 1}</div>
                      <span style={{ color: "#c8e0ec", fontSize: "14px" }}>{layer}</span>
                    </div>
                  ))}
                </div>

                <div style={{ background: "rgba(100,180,255,0.06)", border: "1px solid rgba(100,180,255,0.15)", borderRadius: "3px", padding: "12px", marginBottom: "10px" }}>
                  <div style={{ color: "#6a9ab8", fontSize: "9px", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "5px" }}>Key tip</div>
                  <p style={{ color: "#a8d0e0", fontSize: "13px", margin: 0, lineHeight: 1.5 }}>{rec.keyAdvice}</p>
                </div>

                {rec.watchOut && (
                  <div style={{ background: "rgba(255,200,80,0.05)", border: "1px solid rgba(255,200,80,0.2)", borderRadius: "3px", padding: "12px", marginBottom: "18px" }}>
                    <div style={{ color: "#b89040", fontSize: "9px", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "5px" }}>Watch out</div>
                    <p style={{ color: "#c8a850", fontSize: "13px", margin: 0, lineHeight: 1.5 }}>{rec.watchOut}</p>
                  </div>
                )}

                <div style={{ marginTop: "20px", paddingTop: "18px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <div style={{ color: "#4a6a7a", fontSize: "10px", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "10px", textAlign: "center" }}>How did it feel?</div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {[["too_cold", "🥶 Too cold"], ["just_right", "✓ Just right"], ["too_hot", "🥵 Too warm"]].map(([val, label]) => (
                      <button key={val} onClick={() => handleFeedback(val)} style={{
                        flex: 1, padding: "9px 4px",
                        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)",
                        color: "#8ab8cc", borderRadius: "3px", fontSize: "11px", cursor: "pointer",
                        fontFamily: "'Georgia', serif",
                      }}>{label}</button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {step === "feedback" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: "36px", marginBottom: "16px" }}>
              {feedback === "just_right" ? "✓" : feedback === "too_cold" ? "🥶" : "🥵"}
            </div>
            <h2 style={{ color: "#e8f4f8", fontSize: "18px", fontWeight: "normal", marginBottom: "8px" }}>
              {feedback === "just_right" ? "Perfect." : "Got it."}
            </h2>
            <p style={{ color: "#6a9ab8", fontSize: "13px", marginBottom: "8px", fontStyle: "italic" }}>
              {feedback === "just_right" ? "We'll keep that calibration." : feedback === "too_cold" ? "We'll layer up next time." : "We'll dial it back next time."}
            </p>
            <p style={{ color: "#3a5a6a", fontSize: "11px", marginBottom: "24px" }}>
              {feedbackHistory.length} data point{feedbackHistory.length !== 1 ? "s" : ""} collected.
            </p>
            <button onClick={handleRefresh} style={{
              padding: "12px 28px", background: "rgba(100,180,255,0.1)",
              border: "1px solid rgba(100,180,255,0.3)", color: "#a8d8f0",
              borderRadius: "3px", fontSize: "12px", letterSpacing: "0.15em",
              textTransform: "uppercase", cursor: "pointer", fontFamily: "'Georgia', serif",
            }}>New recommendation →</button>
          </div>
        )}
      </div>

      <div style={{ marginTop: "20px", color: "#2a4a5a", fontSize: "11px", letterSpacing: "0.1em" }}>WEARTHER · BETA</div>

      <style>{`
        @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.1); opacity: 1; } }
        * { box-sizing: border-box; }
        input[type="text"]::placeholder { color: #3a5a6a; }
        input[type="text"]:focus { outline: none; border-color: rgba(100,180,255,0.4) !important; }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 16px; height: 16px; border-radius: 50%;
          background: rgba(100,180,255,0.9); border: 2px solid rgba(100,180,255,0.4);
          cursor: pointer; margin-top: -7px;
        }
        input[type="range"]::-webkit-slider-runnable-track { height: 2px; border-radius: 1px; }
        input[type="range"]::-moz-range-thumb {
          width: 16px; height: 16px; border-radius: 50%;
          background: rgba(100,180,255,0.9); border: 2px solid rgba(100,180,255,0.4); cursor: pointer;
        }
      `}</style>
    </div>
  );
}