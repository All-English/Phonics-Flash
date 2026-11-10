const fs = require('fs');
const path = require('path');

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('Error: ELEVENLABS_API_KEY environment variable is required.');
  process.exit(1);
}

const VOICES = [
  { name: 'Jessica', id: 'cgSgspJ2msm6clMCkdW9', gender: 'F' },
  { name: 'Laura', id: 'FGY2WhTYpPnrIDTdsKH5', gender: 'F' },
  { name: 'Sarah', id: 'EXAVITQu4vr4xnSDxMaL', gender: 'F' },
  { name: 'Bella', id: 'hpp4J3VqNfWAUOO0d1Us', gender: 'F' },
  { name: 'Matilda', id: 'XrExE9yKIg1WjnnlVkGX', gender: 'F' },
  { name: 'Arabella', id: 'Z3R5wn05IrDiVCyEkUrK', gender: 'F' },
  { name: 'River', id: 'SAz9YHcvj6GT2YYXdXww', gender: 'N' },
  { name: 'Chris', id: 'iP95p4xoKVk53GoZ742B', gender: 'M' },
  { name: 'Liam', id: 'TX3LPaxmHKxFdv7VOQHJ', gender: 'M' },
  { name: 'Eric', id: 'cjVigY5qzO86Huf0OWal', gender: 'M' },
  { name: 'Callum', id: 'N2lVS1w4EtoT3dr4eOWO', gender: 'M' },
  { name: 'Brian', id: 'nPczCjzI2devNBz1zQrb', gender: 'M' },
  { name: 'Bill', id: 'pqHfZKP75CvOlQylNhV4', gender: 'M' },
  { name: 'Will', id: 'bIHbv24MWmeRgasZH58o', gender: 'M' },
  { name: 'Roger', id: 'CwhRBWXzGAHq8TQ4Fs17', gender: 'M' }
];

const wordsJsonPath = path.join(__dirname, '..', 'data', 'words.json');
const wordsData = JSON.parse(fs.readFileSync(wordsJsonPath, 'utf8'));

// 1. Collect all extra words with their location
const allExtraWords = [];
for (let l = 0; l < wordsData.levels.length; l++) {
  const lvl = wordsData.levels[l];
  for (let uIdx = 0; uIdx < lvl.units.length; uIdx++) {
    const u = lvl.units[uIdx];
    if (u.extraWords && Array.isArray(u.extraWords)) {
      // Find sounds directory from regular words
      let soundDir = null;
      if (u.words && u.words.length > 0 && u.words[0].audio) {
        soundDir = path.dirname(u.words[0].audio);
      } else {
        const levelNum = l + 1;
        soundDir = `media/SmartPhonics/${levelNum}/Unit${uIdx + 1}/sounds`;
      }

      for (let ewIdx = 0; ewIdx < u.extraWords.length; ewIdx++) {
        const ew = u.extraWords[ewIdx];
        allExtraWords.push({
          levelIndex: l,
          unitIndex: uIdx,
          extraWordIndex: ewIdx,
          unitId: u.id,
          soundDir: soundDir,
          wordObj: ew,
          wordText: ew.word
        });
      }
    }
  }
}

console.log(`Found ${allExtraWords.length} extra words to process.`);

// 2. Allocate 3 balanced voices per word
const voiceCounts = Object.fromEntries(VOICES.map(v => [v.name, 0]));

allExtraWords.forEach((item, idx) => {
  const chosenVoices = [];

  // Slot 1: Female voice with lowest usage
  const fCandidates = VOICES.filter(v => v.gender === 'F').sort((a, b) => voiceCounts[a.name] - voiceCounts[b.name]);
  const fVoice = fCandidates[0];
  chosenVoices.push(fVoice);
  voiceCounts[fVoice.name]++;

  // Slot 2: Male voice with lowest usage
  const mCandidates = VOICES.filter(v => v.gender === 'M').sort((a, b) => voiceCounts[a.name] - voiceCounts[b.name]);
  const mVoice = mCandidates[0];
  chosenVoices.push(mVoice);
  voiceCounts[mVoice.name]++;

  // Slot 3: Any remaining voice with lowest overall usage
  const remCandidates = VOICES.filter(v => !chosenVoices.includes(v)).sort((a, b) => voiceCounts[a.name] - voiceCounts[b.name]);
  const remVoice = remCandidates[0];
  chosenVoices.push(remVoice);
  voiceCounts[remVoice.name]++;

  item.assignedVoices = chosenVoices;
});

console.log('Voice usage distribution across all 786 audio files:');
console.log(voiceCounts);

// 3. Generation helper with retry logic
async function generateTTS(text, voice, destPath, retries = 3) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
    return { skipped: true };
  }

  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`;
  const payload = {
    text: text,
    model_id: 'eleven_v4_turbo',
    voice_settings: {
      speed: 0.85,
      stability: 0.5,
      similarity_boost: 0.75
    },
    pronunciation_dictionary_locators: [
      {
        pronunciation_dictionary_id: 'sKcMTMc7IZdOIqGSuKGL',
        version_id: 'lBWAKvEKQsfx4Ajakhf7'
      }
    ]
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey
        },
        body: JSON.stringify(payload)
      });

      if (res.status === 429) {
        console.warn(`[429 Rate Limit] Backing off for 3s before retry ${attempt}/${retries}...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API error ${res.status}: ${errText}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(destPath, buffer);
      return { success: true, bytes: buffer.length };
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`Attempt ${attempt} failed: ${err.message}. Retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// 4. Download files with concurrency control
async function run() {
  const tasks = [];
  for (const item of allExtraWords) {
    const cleanWord = item.wordText.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const audioPaths = [];

    for (const voice of item.assignedVoices) {
      const filename = `extra_${cleanWord}_${voice.name.toLowerCase()}.mp3`;
      const relPath = `${item.soundDir}/${filename}`;
      const fullPath = path.join(__dirname, '..', relPath);

      audioPaths.push(relPath);
      tasks.push({
        word: item.wordText,
        voice: voice,
        destPath: fullPath,
        relPath: relPath
      });
    }

    // Attach audio array to word object
    item.wordObj.audio = audioPaths;
  }

  console.log(`\nStarting generation of ${tasks.length} audio files...`);

  const CONCURRENCY = 3;
  let completed = 0;
  let skipped = 0;
  let generated = 0;

  async function worker(taskQueue) {
    while (taskQueue.length > 0) {
      const task = taskQueue.shift();
      try {
        const result = await generateTTS(task.word, task.voice, task.destPath);
        if (result.skipped) {
          skipped++;
        } else {
          generated++;
        }
        completed++;
        if (completed % 25 === 0 || completed === tasks.length) {
          process.stdout.write(`\rProgress: ${completed}/${tasks.length} (${generated} generated, ${skipped} cached)`);
        }
      } catch (err) {
        console.error(`\nFailed to generate "${task.word}" with voice ${task.voice.name}:`, err.message);
      }
      // Small delay between requests to be kind to the API
      await new Promise(r => setTimeout(r, 150));
    }
  }

  const queue = [...tasks];
  const workers = Array.from({ length: CONCURRENCY }, () => worker(queue));
  await Promise.all(workers);

  console.log(`\n\nAudio generation complete! (${generated} generated, ${skipped} cached).`);

  // 5. Save updated words.json
  fs.writeFileSync(wordsJsonPath, JSON.stringify(wordsData, null, 2) + '\n', 'utf8');
  console.log(`Updated ${wordsJsonPath} successfully!`);
}

run().catch(err => {
  console.error('Fatal error during execution:', err);
  process.exit(1);
});
