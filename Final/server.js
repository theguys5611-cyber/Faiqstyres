import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

//Using Cors
const ALLOWED_ORIGINS = [
    // Local dev
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:5501',
    'http://127.0.0.1:5501',
    'http://localhost:3000',
    
    ...(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL] : []),
    ...(process.env.ALLOWED_ORIGIN     ? [process.env.ALLOWED_ORIGIN]      : []),
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, Render health-checks)
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        console.warn(`[CORS] Blocked origin: ${origin}`);
        callback(new Error(`CORS policy: origin ${origin} not allowed`));
    },
    credentials: true
}));

app.use(express.json({ limit: '10mb' })); // Allow larger payloads for base64 images


app.use(express.static(path.join(__dirname, 'public')));


if (!process.env.GEMINI_API_KEY) {
    console.error("ERROR: GEMINI_API_KEY not found in environment variables");
    console.log("\nSet GEMINI_API_KEY in your Render environment variables.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });





function extractLargestRimInches(html) {
    const matches = html.match(/\d{3}\/\d{2}[ZP]?R(\d{2})/gi);
    if (!matches || matches.length === 0) return null;

    const rimValues = matches
        .map(s => {
            const m = s.match(/R(\d{2})$/i);
            return m ? parseInt(m[1]) : 0;
        })
        .filter(n => n >= 14 && n <= 24);

    if (rimValues.length === 0) return null;
    return Math.max(...rimValues);
}

// Find a matching tyre size string for a given rim inch value 
function getTyreSizeForRim(html, rimInches) {
    const pattern = new RegExp(`\\d{3}\\/\\d{2}[ZP]?R${rimInches}(?!\\d)`, 'i');
    const match = html.match(pattern);
    return match ? match[0] : null;
}


app.post("/ask-ai", async (req, res) => {
    const { message, inventory } = req.body;

    if (!message) {
        return res.status(400).json({ error: "No message provided." });
    }

    console.log(`[${new Date().toISOString()}] /ask-ai called`);

    try {
        const systemContext = inventory
            ? `You are a helpful tyre shop assistant for Faiq's Tyres (South Africa). 
You ONLY recommend tyres that exist in the inventory below — never invent products.
Be concise, friendly, and knowledgeable. Prices are in South African Rand (R).

Current inventory:
${inventory}`
            : `You are a helpful tyre shop assistant for Faiq's Tyres (South Africa). Be concise and friendly.`;

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: `${systemContext}\n\n${message}` }] }]
        });

        const reply = result.response.text();
        console.log(`[/ask-ai] Reply (first 120 chars): ${reply.substring(0, 120)}`);
        res.json({ reply });
    } catch (err) {
        console.error(`[/ask-ai] Error: ${err.message}`);
        res.status(500).json({ error: "AI request failed. Please try again." });
    }
});

//  Car tyre lookup 
app.post("/lookup-car-tyres", async (req, res) => {
    const { make, model: carModel, year, inventory } = req.body;

    if (!make || !carModel) {
        return res.status(400).json({ error: "Make and model are required." });
    }

    console.log(`[${new Date().toISOString()}] Looking up: ${year} ${make} ${carModel}`);

    let oeSize = "Unknown";
    let rimInches = 0;

    const makeSlug  = make.toLowerCase().replace(/\s+/g, '-');
    const modelSlug = carModel.toLowerCase().replace(/\s+/g, '-');
    const yearPart  = year ? `${year}/` : '';

    const scrapeHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    };

    // SOURCE 1: wheel-size.com 
    try {
        const url = `https://www.wheel-size.com/size/${makeSlug}/${modelSlug}/${yearPart}`;
        console.log(`[wheel-size.com] GET ${url}`);
        const resp = await axios.get(url, { timeout: 6000, headers: scrapeHeaders });
        const largest = extractLargestRimInches(resp.data);
        if (largest) {
            rimInches = largest;
            oeSize = getTyreSizeForRim(resp.data, largest) || oeSize;
            console.log(`[wheel-size.com] Largest rim: ${largest}" | Size: ${oeSize}`);
        } else {
            console.log(`[wheel-size.com] No tyre sizes found in page`);
        }
    } catch (err) {
        console.log(`[wheel-size.com] Failed: ${err.message}`);
    }

    // SOURCE 2: tirewheelguide.com 
    if (rimInches === 0) {
        try {
            const url = `https://tirewheelguide.com/sizes/${makeSlug}/${modelSlug}/${yearPart}`;
            console.log(`[tirewheelguide.com] GET ${url}`);
            const resp = await axios.get(url, { timeout: 6000, headers: scrapeHeaders });
            const largest = extractLargestRimInches(resp.data);
            if (largest) {
                rimInches = largest;
                oeSize = getTyreSizeForRim(resp.data, largest) || oeSize;
                console.log(`[tirewheelguide.com] Largest rim: ${largest}" | Size: ${oeSize}`);
            }
        } catch (err) {
            console.log(`[tirewheelguide.com] Failed: ${err.message}`);
        }
    }

    // SOURCE 3: Gemini AI 
    if (rimInches === 0) {
        try {
            console.log(`[AI Lookup] Both web sources failed — asking Gemini...`);
            const lookupPrompt = `You are an automotive tyre fitment expert with full knowledge of every trim level.

List ALL OE rim sizes for a ${year || ''} ${make} ${carModel}, including base AND premium trims (Sport, N-Line, Limited, etc.).

CRITICAL RULES:
1. If the car is very new (2025+) and you lack data, use the most recent available model year.
2. Set "rimInches" to the LARGEST available rim size — do NOT default to the base trim only.
3. Return ONLY a raw JSON object. No markdown, no extra text.
4. Shape: {"oeSize": "235/40R18", "rimInches": 18, "allSizes": ["205/55R16","225/45R17","235/40R18"]}`;

            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: lookupPrompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            });

            const parsed = JSON.parse(result.response.text());
            if (parsed.oeSize && parsed.rimInches) {
                oeSize = parsed.oeSize;
                rimInches = parsed.rimInches;
                console.log(`[AI Lookup] Found: ${oeSize} (${rimInches}")`);
            }
        } catch (aiErr) {
            console.error(`[AI Lookup] Failed: ${aiErr.message}`);
        }
    }

    
    let bestTyreId = null;
    let matchReason = null;
    if (inventory) {
        const tyres = inventory.split('\n').map(line => {
            const [id, name, size, price, desc] = line.split('|');
            return { id, name, size, price: parseFloat(price), desc };
        });

        // Try to find an exact OE size match first
        const exactMatch = tyres.find(t => t.size === oeSize);
        if (exactMatch) {
            bestTyreId = exactMatch.id;
            matchReason = `Exact OE size match (${oeSize})`;
        } else {
            // If no exact match, find the closest rim inch match
            let closestTyre = null;
            let closestDiff = Infinity;

            tyres.forEach(t => {
                const match = t.size.match(/R(\d{2})/i);
                if (match) {
                    const tyreRim = parseInt(match[1]);
                    const diff = Math.abs(tyreRim - rimInches);
                    if (diff < closestDiff) {
                        closestDiff = diff;
                        closestTyre = t;
                    }
                }
            });
            if (closestTyre) {
                bestTyreId = closestTyre.id;
                matchReason = `Closest rim size match (${closestTyre.size}) for ${rimInches}" wheels`;
            }
        }
    }

    res.json({
        oeSize,
        rimInches,
        bestTyreId,
        matchReason
    });
});


app.post("/analyse-tyre-image", async (req, res) => {
    const { imageBase64, inventory } = req.body;

    if (!imageBase64) {
        return res.status(400).json({ error: "No image provided." });
    }
    if (!inventory) {
        return res.status(400).json({ error: "No inventory provided." });
    }

    console.log(`[${new Date().toISOString()}] Tyre image analysis requested`);

    try {
        
        const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
        if (!matches) {
            return res.status(400).json({ error: "Invalid image format. Must be a base64 data URL." });
        }
        const mimeType = matches[1];   
        const rawB64   = matches[2];   

        const prompt = `You are an expert tyre analyst. A customer has uploaded a photo of a tyre or a vehicle's tyre area.

STEP 1 — ANALYSE THE IMAGE:
Look carefully at the tyre in the image and extract as much as you can:
- Brand name (e.g. Michelin, Bridgestone, Dunlop, Continental, Goodyear, Pirelli, Firestone)
- Tyre size from the sidewall (e.g. 185/65R15, 265/60R20) — look carefully for numbers
- Tyre type (e.g. all-season, performance, off-road, tubeless, run-flat)
- Tread pattern description (e.g. asymmetric, directional, all-terrain)
- Any other visible details (speed rating, load index, "XL", "Tubeless" markings)

STEP 2 — MATCH TO INVENTORY:
Here is the full inventory (format: ID|Name|Size|Price|Description):
${inventory}

Using everything you observed, pick the TOP 3 best-matching tyres from the inventory above.
Prioritise: exact brand match first, then size match, then type/description match.
If you can't identify the brand or size clearly, pick the 3 most likely matches based on what you can see.

RULES:
- ONLY pick tyres from the inventory list above. Never invent a tyre.
- Return ONLY raw JSON — no markdown, no explanation outside the JSON.
- Return this exact shape:
{
  "analysed": "One sentence summary of what you saw in the image (brand, size, type if visible)",
  "matches": [
    { "id": "<tyre id>", "matchReason": "<why this is a good match>" },
    { "id": "<tyre id>", "matchReason": "<why this is a good match>" },
    { "id": "<tyre id>", "matchReason": "<why this is a good match>" }
  ]
}`;

        const result = await model.generateContent({
            contents: [{
                role: "user",
                parts: [
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: rawB64
                        }
                    },
                    { text: prompt }
                ]
            }],
            generationConfig: { responseMimeType: "application/json" }
        });

        const raw = result.response.text();
        console.log(`[Image Analysis] Raw Gemini response: ${raw.substring(0, 200)}...`);

        const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

        
        const tyreList = inventory.split('\n').map(line => {
            const [id, name, size, price, desc] = line.split('|');
            return { id, name, size, price, desc };
        });

        const hydratedMatches = (parsed.matches || []).map(m => {
            const full = tyreList.find(t => t.id === m.id);
            if (!full) return null;
            return { ...full, matchReason: m.matchReason };
        }).filter(Boolean);

        console.log(`[Image Analysis] Found ${hydratedMatches.length} matches. Analysed: "${parsed.analysed}"`);

        res.json({
            analysed: parsed.analysed || "Tyre analysed successfully.",
            matches: hydratedMatches
        });

    } catch (err) {
        console.error(`[Image Analysis] Error: ${err.message}`);
        res.status(500).json({ error: "Image analysis failed. Please try a clearer photo." });
    }
});


app.get('*', (req, res) => {
    
    if (req.path.startsWith('/api/') || req.path.startsWith('/ask-ai') ||
        req.path.startsWith('/lookup-car-tyres') || req.path.startsWith('/analyse-tyre-image')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    // Otherwise serve the homepage
    res.sendFile(path.join(__dirname, 'public', 'Homepage.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n✅ Faiq's Tyres server running on port ${PORT}`);
    console.log(`   Local:   http://localhost:${PORT}`);
    if (process.env.RENDER_EXTERNAL_URL) {
        console.log(`   Render:  ${process.env.RENDER_EXTERNAL_URL}`);
    }
});
