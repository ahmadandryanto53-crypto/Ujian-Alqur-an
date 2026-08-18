import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "5mb" }));

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Helper for EveryAyah audio URL
function formatAudioUrl(surah: number, ayah: number): string {
  const surahPad = String(surah).padStart(3, '0');
  const ayahPad = String(ayah).padStart(3, '0');
  return `https://everyayah.com/data/Alafasy_128kbps/${surahPad}${ayahPad}.mp3`;
}

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Generate Exam Questions Endpoint
app.post("/api/generate-exam", async (req, res) => {
  try {
    const { selectedJuz = [30], questionCount = 5, testType = "sambung_ayat", difficulty = "sedang" } = req.body;

    if (!Array.isArray(selectedJuz) || selectedJuz.length === 0) {
      return res.status(400).json({ error: "Pilih setidaknya 1 Juz." });
    }

    const count = Math.min(Math.max(1, Number(questionCount) || 5), 30);
    const juzListStr = selectedJuz.join(", ");

    const systemPrompt = `Anda adalah Dewan Penguji & Pakar Tahfidz Al-Qur'an 30 Juz resmi bersertifikasi internasional (Lembaga Pengembangan Tilawatil Qur'an / LPTQ).
Tugas Anda adalah membuat ${count} butir soal ujian tahfidz hafalan Al-Qur'an yang otentik, teliti, dan 100% akurat sesuai Mushaf Al-Qur'an Rasm Utsmani standar Kementerian Agama / Madinah.

KRITERIA WAJIB:
1. Setiap soal HARUS berasal dari salah satu Juz yang diminta: [Juz ${juzListStr}]. DILARANG mengambil ayat di luar daftar Juz ini!
2. Distribusikan soal secara acak namun merata di antara Juz yang dipilih (${juzListStr}).
3. Teks ayat Arab (questionTextArabic dan expectedAnswerArabic) WAJIB lengkap dengan harakat, syaddah, mad, tanwin, dan tanda baca Utsmani yang benar.
4. Format Tipe Soal "${testType}":
   - "sambung_ayat": Berikan 1 potongan/satu ayat penuh yang harus dilanjutkan peserta 2 sampai 3 ayat berikutnya.
   - "tebak_surah": Berikan potongan ayat di tengah surah, minta peserta menebak nama surah, nomor ayat, juz, lalu melanjutkan 1-2 ayat berikutnya.
   - "potongan_tengah": Berikan awal sampai tengah ayat (wakaf), minta peserta melengkapi akhir ayat tersebut dan ayat berikutnya.
   - "campuran": Kombinasikan tipe soal di atas.
5. Tingkat kesulitan: ${difficulty}. (Jika sulit, pilih ayat-ayat serupa/mutasyabihat atau permulaan halaman).
6. Sertakan terjemahan bahasa Indonesia, petunjuk/clue halus untuk penguji (hint), catatan tajwid (tajweedNotes), dan nomor ayat serta surah yang akurat.`;

    const userPrompt = `Buatkan ${count} butir soal ujian hafalan Al-Qur'an untuk Juz: [${juzListStr}] dengan mode: "${testType}" dan tingkat kesulitan: "${difficulty}". Pastikan semua teks Al-Qur'an memiliki harakat lengkap dan akurat.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          description: "Daftar butir soal ujian tahfidz",
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              juz: { type: Type.INTEGER, description: "Nomor Juz (1-30)" },
              surahNumber: { type: Type.INTEGER, description: "Nomor Surah (1-114)" },
              surahName: { type: Type.STRING, description: "Nama Surah latin (misal: Al-Baqarah)" },
              surahNameArabic: { type: Type.STRING, description: "Nama Surah huruf Arab (misal: البقرة)" },
              verseNumber: { type: Type.INTEGER, description: "Nomor Ayat awal soal" },
              endVerseNumber: { type: Type.INTEGER, description: "Nomor Ayat akhir sambungan" },
              instruction: { type: Type.STRING, description: "Instruksi penguji kepada santri (Bahasa Indonesia)" },
              questionType: { type: Type.STRING },
              questionTextArabic: { type: Type.STRING, description: "Teks ayat yang dibacakan/ditampilkan sebagai soal (berharakat)" },
              questionTranslationId: { type: Type.STRING, description: "Terjemahan ayat soal dalam Bahasa Indonesia" },
              expectedAnswerArabic: { type: Type.STRING, description: "Teks lanjutan ayat yang benar (berharakat)" },
              fullAnswerTranslation: { type: Type.STRING, description: "Terjemahan lanjutan ayat" },
              hint: { type: Type.STRING, description: "Bantuan/clue awal kata bagi penguji jika peserta tersendat" },
              tajweedNotes: { type: Type.STRING, description: "Catatan hukum tajwid penting pada ayat ini" },
              expectedAnswerVerses: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    surahNumber: { type: Type.INTEGER },
                    surahName: { type: Type.STRING },
                    surahNameArabic: { type: Type.STRING },
                    verseNumber: { type: Type.INTEGER },
                    textArabic: { type: Type.STRING },
                    translationId: { type: Type.STRING },
                  },
                  required: ["surahNumber", "verseNumber", "textArabic"]
                }
              }
            },
            required: [
              "juz",
              "surahNumber",
              "surahName",
              "surahNameArabic",
              "verseNumber",
              "instruction",
              "questionTextArabic",
              "expectedAnswerArabic"
            ]
          }
        }
      }
    });

    const text = response.text || "[]";
    const parsed = JSON.parse(text);

    // Enrich with audio URLs and fallback IDs
    const questions = parsed.map((q: any, idx: number) => ({
      ...q,
      id: q.id || `ai-q-${q.juz}-${q.surahNumber}-${q.verseNumber}-${idx}-${Date.now()}`,
      audioUrl: formatAudioUrl(q.surahNumber, q.verseNumber),
      expectedAnswerVerses: (q.expectedAnswerVerses || []).map((v: any) => ({
        ...v,
        audioUrl: formatAudioUrl(v.surahNumber || q.surahNumber, v.verseNumber)
      }))
    }));

    return res.json({
      success: true,
      count: questions.length,
      questions,
      selectedJuz
    });
  } catch (error: any) {
    console.error("Error generating exam with Gemini:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Gagal membuat soal dengan AI. Menggunakan bank soal darurat.",
    });
  }
});

// Evaluate Recitation Endpoint (AI Assistant for Examiner)
app.post("/api/evaluate-recitation", async (req, res) => {
  try {
    const { questionText, expectedText, studentRecitation, surahName, verseNumber } = req.body;

    const prompt = `Anda adalah Penguji Tahfidz Al-Qur'an.
Surah: ${surahName}, Ayat: ${verseNumber}
Soal Ayat: ${questionText}
Kunci Jawaban yang Benar: ${expectedText}
Bacaan Santri / Masukan Penguji: ${studentRecitation || "Santri lancar tanpa bantuan."}

Berikan evaluasi singkat dan konstruktif:
1. Penilaian Kelancaran (Lancar / Cukup / Kurang / Belum Hafal)
2. Estimasi Nilai (0 - 100)
3. Koreksi Tajwid & Makharijul Huruf jika ada
4. Rekomendasi muraja'ah`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: prompt,
      config: {
        systemInstruction: "Anda adalah penguji tahfidz ramah dan teliti. Berikan ulasan dalam format Bahasa Indonesia yang rapi dan mudah dibaca.",
        temperature: 0.2
      }
    });

    return res.json({
      success: true,
      evaluation: response.text
    });
  } catch (error: any) {
    console.error("Error evaluating recitation:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Gagal memproses evaluasi AI."
    });
  }
});

// Quran Information Helper (Random Verse Discovery)
app.post("/api/random-verse", async (req, res) => {
  try {
    const { juz = 30 } = req.body;
    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: `Pilihkan satu ayat acak yang indah dan menantang dari Juz ${juz}. Berikan teks Arab lengkap berharakat, nama surah, nomor surah, nomor ayat, dan terjemahan Indonesia.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            juz: { type: Type.INTEGER },
            surahNumber: { type: Type.INTEGER },
            surahName: { type: Type.STRING },
            surahNameArabic: { type: Type.STRING },
            verseNumber: { type: Type.INTEGER },
            textArabic: { type: Type.STRING },
            translationId: { type: Type.STRING },
            nextVerseArabic: { type: Type.STRING }
          },
          required: ["juz", "surahNumber", "surahName", "verseNumber", "textArabic"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    parsed.audioUrl = formatAudioUrl(parsed.surahNumber, parsed.verseNumber);
    return res.json({ success: true, data: parsed });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server Ujian Tahfidz Al-Qur'an 30 Juz running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
