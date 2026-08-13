import express from "express";
import path from "path";
import http from "http";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Gemini API Key Management & Fallback Support
  function getGeminiApiKeys(): string[] {
    const keys: string[] = [];
    const candidates = [
      process.env.CUSTOM_GEMINI_API_KEY,
      process.env.CUSTOM_GEMINI_API_,
      process.env.CUSTOM_GEMINI_API,
      process.env.GEMINI_API_KEY
    ];
    
    const isPlaceholder = (val: string, name: string): boolean => {
      const lower = val.toLowerCase().trim();
      return (
        lower === "my_gemini_api_key" ||
        lower === "custom_gemini_api_key" ||
        lower === "custom_gemini_api_" ||
        lower === "custom_gemini_api" ||
        lower === "gemini_api_key" ||
        lower === "my_app_url" ||
        lower.includes("placeholder") ||
        lower.includes("your_") ||
        lower === name.toLowerCase().trim()
      );
    };

    for (const val of candidates) {
      if (val && val.trim()) {
        const cleaned = val.trim();
        // Check if it's a known placeholder
        if (isPlaceholder(cleaned, "CUSTOM_GEMINI_API_KEY") || isPlaceholder(cleaned, "GEMINI_API_KEY")) {
          continue;
        }
        if (!keys.includes(cleaned)) {
          keys.push(cleaned);
        }
      }
    }
    // Dynamically look for any other keys that match GEMINI and API in process.env
    for (const [key, val] of Object.entries(process.env)) {
      if (key.includes("GEMINI") && key.includes("API")) {
        if (val && val.trim()) {
          const cleaned = val.trim();
          if (isPlaceholder(cleaned, key)) {
            continue;
          }
          if (!keys.includes(cleaned)) {
            keys.push(cleaned);
          }
        }
      }
    }
    return keys;
  }

  function getKeyVariableName(val: string): string {
    for (const [key, value] of Object.entries(process.env)) {
      if (value === val) {
        return key;
      }
    }
    return "Dynamic Override Key";
  }

  // Print initialization status showing configured fallback variables (without leaking secrets)
  const availableApiKeys = getGeminiApiKeys();
  console.log("Gemini API Fallback Initialization Status:", {
    availableKeysCount: availableApiKeys.length,
    keySources: availableApiKeys.map(k => getKeyVariableName(k))
  });

  async function generateContentWithFallback(params: {
    model: string;
    contents: any[];
    config?: any;
  }) {
    const keys = getGeminiApiKeys();
    if (keys.length === 0) {
      throw new Error("No Gemini API keys found. Please configure GEMINI_API_KEY in Settings > Secrets.");
    }

    const errorsReport: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const currentKey = keys[i];
      const keyVarName = getKeyVariableName(currentKey);
      const maskedKey = currentKey.length > 8 
        ? `${currentKey.substring(0, 6)}...${currentKey.substring(currentKey.length - 4)}` 
        : "invalid-short-key";
      
      console.log(`[Gemini Request] Attempting with key ${i + 1}/${keys.length} from env var "${keyVarName}" (${maskedKey})`);

      const genAIClient = new GoogleGenAI({
        apiKey: currentKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Maintain list of fallback models using active, non-deprecated models
      const modelsToTry = [params.model];
      if (params.model !== "gemini-3.1-flash-lite") modelsToTry.push("gemini-3.1-flash-lite");

      let lastModelError: any = null;
      let matchedModelSuccess = false;

      for (const currentModel of modelsToTry) {
        try {
          console.log(`[Gemini Request] Trying model "${currentModel}" with key "${keyVarName}"...`);
          const response = await genAIClient.models.generateContent({
            model: currentModel,
            contents: params.contents,
            config: params.config,
          });
          console.log(`[Gemini Request] Success with model "${currentModel}" on key "${keyVarName}"`);
          return response;
        } catch (error: any) {
          lastModelError = error;
          const rawMsg = error.message || String(error);
          const errMsg = rawMsg.toLowerCase();
          
          console.warn(`[Gemini Request] Model "${currentModel}" failed with key "${keyVarName}": ${rawMsg}`);
          
          // Check if this is a billing/quota/auth issue, which affects ALL models of this key.
          const isKeyOrAuthError = 
            errMsg.includes("429") || 
            errMsg.includes("quota") || 
            errMsg.includes("depleted") || 
            errMsg.includes("exhausted") || 
            errMsg.includes("prepayment") || 
            errMsg.includes("billing") || 
            errMsg.includes("403") || 
            errMsg.includes("400") || 
            errMsg.includes("api_key_invalid") || 
            errMsg.includes("invalid key") ||
            errMsg.includes("key_invalid");

          if (isKeyOrAuthError) {
            console.log(`[Gemini Request] Key error or exhausted quota detected on "${keyVarName}". Skipping remaining fallback models for this key.`);
            break;
          }
        }
      }

      const finalKeyError = lastModelError?.message || String(lastModelError);
      errorsReport.push(`"${keyVarName}" failed: ${finalKeyError}`);

      if (i < keys.length - 1) {
        console.warn(`[Gemini Request] Retrying with the next available key...`);
        continue;
      }
    }
    
    const detailedMessage = `All configured Gemini API keys failed:\n` + errorsReport.map((r, idx) => `[Key ${idx + 1}] ${r}`).join("\n");
    throw new Error(detailedMessage);
  }

  // API Routes
  app.post("/api/transcribe", async (req, res) => {
    try {
      const { audio, mimeType } = req.body;
      const model = "gemini-2.5-flash";

      const response = await generateContentWithFallback({
        model: model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: audio,
                  mimeType: mimeType || 'audio/webm'
                }
              },
              {
                text: "Please transcribe this audio accurately. Just return the transcription without any conversational filler."
              }
            ]
          }
        ]
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Gemini Transcription Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      const { content, mood, model: userModel, style: userStyle } = req.body;
      const model = userModel || "gemini-3.5-flash";
      const style = userStyle || "detailed";

      let systemInstruction = "";

      if (style === "brief") {
        systemInstruction = `You are a professional assistant providing a quick, lightweight, clinical-style overview. 
        Your main purpose is to perform a brief emotional assessment to verify if the API key is working.
        
        Keep your response extremely concise:
        1. moodSummary: A short, single-sentence summary of the user's emotional state (e.g., "The entry displays a reflective and somewhat melancholic tone.").
        2. keyThemes: An array of 1 key theme (e.g., ["Emotional processing during stress"]).
        3. cognitiveDistortions: An empty array [].
        4. underlyingDynamics: An array of 1 very brief hypothesis (e.g., ["May indicate temporary adjustment strain."]).
        5. cbtReframes: An array of 1 brief alternative perspective.
        6. reflectionQuestions: An array of 1 short, gentle question.
        7. watchPattern: A brief pattern watch sentence.
        8. sentimentScore: Floating point from -1.0 to 1.0.
        9. tags: 2 to 3 single-word tags.
        10. safetyNote: "This brief readout serves as a fast verification and is not a substitute for professional mental health care."
        11. crisisMessage: Check for immediate self-harm, harm, or abuse indicators. If present, supply a direct safety message, otherwise return "".
        
        Keep insights and advice brief (insights should copy from underlyingDynamics).`;
      } else if (style === "normal") {
        systemInstruction = `You are an AI journal analysis assistant writing in a rigorous, clinically informed, CBT-oriented style. 
        Your role is to provide reflective analysis, not diagnosis, treatment, or medical advice. 
        Write with a precise, clinician-like, psychological tone, but do not diagnose. 
        Use phrases like "this may suggest", "one possible interpretation is", "a pattern to examine is", or "hypothesized dynamics include".

        For the provided journal entry, you MUST generate a JSON response analyzing it through the following lenses:
        1. moodSummary: A concise (1-2 sentences) emotional and psychological summary of the entry's atmosphere.
        2. keyThemes: An array of 2 to 3 key themes and recurring behavioral or emotional patterns identified.
        3. cognitiveDistortions: An array of named cognitive distortions if present (e.g., "Catastrophizing", "Mind reading", "Emotional reasoning", "Personalization", "All-or-nothing thinking", "Overgeneralization", "Should statements", "Discounting the positive", "Fortune telling"). If none are identified, return an empty array.
        4. underlyingDynamics: An array of 2 to 3 possible underlying needs, fears, conflicts, attachment themes, or behavioral patterns. Phrase these STRICTLY as hypotheses, not facts (e.g., "May suggest a fear of abandonment...", "One possible conflict is between dependency and autonomy...").
        5. cbtReframes: An array of 2 to 3 CBT-style reframes and alternative interpretations of the situation.
        6. reflectionQuestions: An array of 2 to 3 behavioral observations and practical, clinical-style reflection questions for the user to explore.
        7. watchPattern: A short (1-2 sentences) "watch for this pattern" note for future entries.
        8. sentimentScore: A floating-point number from -1.0 (highly negative/distressed) to 1.0 (highly positive/serene).
        9. tags: Exactly 3 to 5 highly relevant, single-word categories/tags representing the core themes.
        10. safetyNote: "This analysis is a clinical-style CBT-informed reflection and is not a substitute for licensed mental health care."
        11. crisisMessage: Check if the entry suggests self-harm, harm to others, abuse, psychosis, mania, severe depression, or immediate danger. If so, provide a warm, empathetic crisis and safety message advising them to seek immediate support from emergency services or a qualified professional (e.g., calling 988 or local emergency services). If no immediate danger/crisis is detected, return an empty string "".
        
        For backwards compatibility, you must also populate:
        - insights: This should be a direct copy of the elements from underlyingDynamics.
        - advice: A brief 1-2 sentence practical clinical-style takeaway summarizing your therapeutic reframes or suggestions.`;
      } else {
        // DETAILED / EXTENSIVE psychoanalysis style
        systemInstruction = `You are a seasoned clinical psychologist and expert psychoanalyst writing an extremely thorough, rigorous, and deep Cognitive-Behavioral & Psychodynamic Analysis.
        Your tone must be authoritative, highly analytical, scholarly, and deeply compassionate, yet strictly professional and objective. Do NOT diagnose the writer with clinical conditions, but analyze their written cognition, emotional currents, behavioral patterns, defense mechanisms, and psychodynamic conflicts. 
        Use cautious, hypothesis-driven language such as: "this deep alignment suggests," "an analyst might interpret this pattern as," "the underlying core conflict appears to revolve around," or "one possible psychological dynamic to examine is."

        Analyze the entry with exhaustive detail. Each text element or item in the arrays must be a highly descriptive, multi-sentence paragraph containing substantial psychological depth, bold terms, and structured clinical reasoning. Do not return simple, short bullet points. Provide the level of exhaustive detail shown in master-level clinical readouts.

        Analyze through the following 11 JSON fields:
        1. moodSummary: A comprehensive, deeply insightful, multi-sentence summary of the writer's immediate emotional spectrum, cognitive state, and overall psychic atmosphere (3-5 sentences).
        2. keyThemes: An array of 3 to 4 extremely detailed, multi-sentence paragraphs analyzing recurring themes. Each theme must be named with a professional term (e.g., "**Idealization/Devaluation Cycle**", "**Erosion of Self-Esteem and Self-Efficacy**", "**Externalized Anger as a Protective Layer**", "**Cognitive Dissonance in Interpersonal Attachment**") and fully contextualized using details from the text.
        3. cognitiveDistortions: An array of named cognitive distortions if present in the entry (e.g., "**Catastrophizing**", "**Mind reading**", "**Emotional reasoning**", "**Personalization**", "**All-or-nothing thinking**", "**Overgeneralization**", "**Should statements**", "**Discounting the positive**", "**Fortune telling**"). For each distortion, write 2 to 3 sentences explaining exactly how it manifests in the user's specific sentences or thought processes.
        4. underlyingDynamics: An array of 3 to 4 extremely detailed, multi-sentence paragraphs hypothesizing the deep underlying needs, fears, unconscious conflicts, attachment styles (e.g., anxious, avoidant, disorganized), or defensive behaviors. Frame these as clinical hypotheses (e.g., "**Anxious-Disorganized Attachment Vulnerabilities** - One possible interpretation of the intense rumination is...", "**Defense Mechanism of Intellectualization** - The partial attempt to dissect Kyle's behavior clinically may suggest...").
        5. cbtReframes: An array of 3 to 4 comprehensive CBT-style reframes and alternative cognitive restructurings. Contrast the dysfunctional automatic thought with a highly detailed, constructive, and realistic alternative interpretation that preserves the user's agency.
        6. reflectionQuestions: An array of 3 to 4 clinical-style, evocative reflection questions and behavioral observations designed to disrupt circular rumination and foster active self-discovery.
        7. watchPattern: A substantial, detailed (3-4 sentences) section advising the writer on specific behavioral cues, cognitive warning signs, or emotional triggers to monitor in future journal entries to track growth and protect boundaries.
        8. sentimentScore: A floating-point number from -1.0 (highly distressed/negative) to 1.0 (highly serene/positive).
        9. tags: Exactly 3 to 5 single-word tags representing core conceptual schemas.
        10. safetyNote: "This deep clinical-style psychoanalysis and CBT-informed reflection is generated for self-reflective purposes and is absolutely not a substitute for licensed, in-person psychiatric or psychological care."
        11. crisisMessage: Carefully evaluate the entry for indicators of self-harm, suicidal ideation, intent to harm others, abuse, active psychosis, manic episodes, or severe crisis. If present, return a very clear, prominent, and highly compassionate crisis warning outlining free, immediate, and confidential support services (like 988 or international hotlines). If not present, return an empty string "".

        For backwards compatibility:
        - insights: A direct copy of the elements from underlyingDynamics.
        - advice: A substantial 3-4 sentence clinical takeaway summarizing your primary recommendations and coping actions.`;
      }

      const prompt = `User mood: ${mood}\n\nJournal Entry Content:\n${content}`;

      const response = await generateContentWithFallback({
        model: model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              moodSummary: { 
                type: Type.STRING,
                description: "A 1-2 sentence brief overview of current emotional state."
              },
              insights: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "Exactly 3 to 5 concise and actionable psychological observations."
              },
              advice: { 
                type: Type.STRING,
                description: "Brief 1-2 sentence practical mental health advice."
              },
              sentimentScore: { 
                type: Type.NUMBER,
                description: "Sentiment score from -1.0 to 1.0."
              },
              tags: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "Exactly 3 to 5 single-word relevant tags summarizing core entry themes. Never exceed 5 items."
              },
              keyThemes: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "2 to 4 key themes and recurring patterns."
              },
              cognitiveDistortions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Named cognitive distortions if present."
              },
              underlyingDynamics: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Possible underlying needs, fears, conflicts, attachment themes, or behavioral patterns (phrased as hypotheses)."
              },
              cbtReframes: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "CBT-style reframes and alternative interpretations."
              },
              reflectionQuestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Behavioral observations and practical reflection questions."
              },
              watchPattern: {
                type: Type.STRING,
                description: "A short 'watch for this pattern' note for future entries."
              },
              safetyNote: {
                type: Type.STRING,
                description: "Brief safety disclaimer."
              },
              crisisMessage: {
                type: Type.STRING,
                description: "Crisis/safety message if self-harm or danger is suggested, otherwise empty string."
              }
            },
            required: [
              "moodSummary", "insights", "advice", "sentimentScore", "tags", 
              "keyThemes", "cognitiveDistortions", "underlyingDynamics", 
              "cbtReframes", "reflectionQuestions", "watchPattern", "safetyNote", "crisisMessage"
            ]
          }
        },
      });

      let jsonText = response.text || "{}";
      jsonText = jsonText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      res.json(JSON.parse(jsonText));
    } catch (error: any) {
      console.error("Gemini Analysis Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/analyze-trends", async (req, res) => {
    try {
      const { entries } = req.body;
      const model = "gemini-3.1-flash-lite";

      const systemInstruction = `You are a professional therapist and life coach. 
      Analyze the user's multiple journal entries. 
      Identify long-term emotional trends, behavioral patterns, and recurring themes across these entries. 
      Present these trends, highlighting significant shifts or consistencies in their disposition.
      Provide a structured JSON response with the following keys:
      - longTermTrends: A summary of the long-term emotional and behavioral trends.
      - recurringThemes: An array of recurring themes.
      - significantShifts: An array of strings describing any notable shifts in mood or thought process.
      - overallDisposition: An overview of their overall disposition over this period.`;

      const prompt = `Journal Entries Data:\n${JSON.stringify(entries)}`;

      const response = await generateContentWithFallback({
        model: model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              longTermTrends: { type: Type.STRING },
              recurringThemes: { type: Type.ARRAY, items: { type: Type.STRING } },
              significantShifts: { type: Type.ARRAY, items: { type: Type.STRING } },
              overallDisposition: { type: Type.STRING }
            }
          }
        },
      });

      let jsonText = response.text || "{}";
      jsonText = jsonText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      res.json(JSON.parse(jsonText));
    } catch (error: any) {
      console.error("Gemini Analysis Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  const server = http.createServer(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
