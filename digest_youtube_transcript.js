import {YoutubeTranscript} from './youtube-fetcher.js';
import OpenAI from "openai";
import dotenv from "dotenv";
import fs from 'fs';
import { marked } from 'marked';
import path from 'path';
import {fileURLToPath} from 'url';
import {zodResponseFormat} from "openai/helpers/zod";
import {z} from "zod";




import ytdl from "ytdl-core"

ytdl('http://www.youtube.com/watch?v=aqz-KE-bpKQ')
  .pipe(fs.createWriteStream('video.mp4'));








dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
    apiKey: process.env['OPENAI_API_KEY'], // This is the default and can be omitted
});

// Ensure the directory exists
const ensureDirectoryExistence = (filePath) => {
    const dirname = path.dirname(filePath);
    if (!fs.existsSync(dirname)) {
        fs.mkdirSync(dirname, { recursive: true });
    }
};

function extractYoutubeId(input) {
    // Regular expression to match YouTube video ID from different URL formats
    const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;

    // If the input is already a clean ID (11 characters long)
    if (input.length === 11) {
        return input;
    }

    // Match the input against the regular expression
    const match = input.match(RE_YOUTUBE);

    // If a match is found, return the video ID
    if (match && match[1]) {
        return match[1];
    }

    // If no match is found, throw an error
    throw new Error('Invalid YouTube video ID or URL.');
}

async function fetchTranscriptJson(videoID) {
    return await YoutubeTranscript.fetchTranscript(videoID);
}

async function extractTranscriptText(transcriptObject) {
    return transcriptObject.transcript.map(entry => entry.text).join(' ');
}

async function cleanTranscript(transcriptText, transcriptMetadata) {
    const cleanupPrompt = `
    The youtube transcript provided is in its raw form as a string of words parsed from spoken words on a video.

    add in the proper grammar, punctuation, spelling, etc.
    the goal is to remain as close to verbatim as possible, while cleaning up punctuation.
    use simple unicode characters only, no special characters like m-dashes or open/close quotations.
    consider the title, channel name, and description while cleaning up the transcript. 
    `;

    const cleanupMetadata = {
        title: transcriptMetadata.title,
        channel: transcriptMetadata.channelTitle,
        description: transcriptMetadata.description,
    }

    const cleanupResponse = await openai.chat.completions.create({
        messages: [
            { role: 'system', content: cleanupPrompt },
            { role: 'user', content: JSON.stringify(cleanupMetadata) },
            { role: 'user', content: transcriptText },
        ],
        model: 'gpt-4o-mini', //dumbfast model for transcript cleanup
        temperature: 0.0,
    });

    return cleanupResponse.choices[0].message.content;
}

async function digestTranscript(transcriptText, transcriptMetadata) {
    const digestionPrompt = `
You are an expert summarizer and analyst.
Your task is to read the attached transcript and provide various summaries.
More details can be found in the output schema provided.
Use simple unicode characters only, no special characters like m-dashes or open/close quotations.
Use the attached metadata to guide the summarization process.
`

    const digestionMetadata = {
        title: transcriptMetadata.title,
        channel: transcriptMetadata.channelTitle,
        description: transcriptMetadata.description,
        date: transcriptMetadata.publishedDate,
        duration: transcriptMetadata.duration,
    }

    const transcriptDigest = z.object({
        page_summary: z.string().describe("A concise but detailed short-form wikipedia style article summarizing the content and concepts in the video, keeping the length of these notes between half a page and two pages. Uses a standard markdown document format (starting with a # heading), prioritizing concise bulleted lists of notes over full paragraphs to get more complete coverage. Does not include quotes, keywords, or topic lists, only an simple, structured summary of the content."),
        paragraph_summary: z.string().describe("A concise summary of the transcript, at most a single paragraph."),
        sentence_summary: z.string().describe("An extremely concise summary of the transcript, at most a single sentence."),
        topics: z.array(z.string()).describe("An array of the broad, top-level general-focused themes or subjects discussed in the transcript. These topics should capture the overarching areas of interest or inquiry, providing users with an overview of the primary subjects covered. They should reflect the central themes in the content, offering a high-level understanding of the video."),
        keywords: z.array(z.string()).describe("An array of specific terms or phrases that are significant within the field(s) discussed in the transcript, akin to academic or well-established SEO keywords. These keywords should be precise and widely recognized within the relevant field or domain, aiding in search and discovery of related content. They should serve as effective search terms that encapsulate the detailed content discussed."),
        concepts: z.array(z.string()).describe("An array of educationally-focused ideas or principles that are explored within the transcript. These concepts should aim to represent the underlying notions or theories presented, providing insight into the key educational elements discussed. They should facilitate a deeper understanding of the content by highlighting the critical ideas conveyed in the video."),
        pull_quotes: z.array(z.string()).describe("An array of significant, memorable, or punchy quotes (best if all three!) that communicate core ideas or illustrate points, extracted VERBATIM from the transcript. (with the exception that the audio was highly compressed, so adjusting for obvious errors in transcription is acceptable."),
    }).strict();

    const completion = await openai.beta.chat.completions.parse({
        messages: [
            { role: "system", content: digestionPrompt },
            { role: "user", content: JSON.stringify(digestionMetadata) },
            { role: "user", content: transcriptText },
        ],
        model: "gpt-4o", //midtier model for summarizations
        temperature: 0.0,
        response_format: zodResponseFormat(transcriptDigest, "digest"),
    });

    return completion.choices[0].message.parsed;
}

async function extractTimestampedUtterances(transcriptObject) {
    return transcriptObject.transcript.map(entry => {
        const offsetInSeconds = entry.offset;

        const minutes = Math.floor(offsetInSeconds / 60);
        const seconds = Math.floor(offsetInSeconds % 60); // Use Math.floor to remove decimals

        const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        return `${formattedTime} ${entry.text}`;
    }).join('\n');
}

async function extractChapters(transcriptDigest, transcriptMetadata, timestampedUtterances, videoID) {
    const chapterExtractionPrompt = `
You are an expert YouTube content editor tasked with creating chapter titles for a video based on the attached transcript.
Follow the rules closely, but aim for natural and engaging chapter titles.
Avoid chapters being extraordinarily short or bunched up too closely together.
`

    const chapterSchema = z.object({
        chapters: z.array(
            z.object({
                name: z.string().describe("name of chapter"),
                timestamp: z.string().describe("timestamp of format 00:00"),
                yt_timestamp: z.number().describe("time in seconds only since the beginning (for use in urls with &t=###)"),
            })
        ).describe("An array of chapter titles presented in-order that could be used to break the transcript into sections of a youtube video. These should be concise and descriptive, providing a clear idea of what content is covered in each section of the video. Must start from 00:00 and be listed in ascending order, minimum of 3, and minimum duration of 10 seconds between.")
    }).describe("Schema for chapters");

    const chapterMetadata = {
        title: transcriptDigest.page_summary,
        channel: transcriptDigest.channel,
        description: transcriptDigest.paragraph_summary,
    }

    const completion = await openai.beta.chat.completions.parse({
        messages: [
            { role: "system", content: chapterExtractionPrompt },
            { role: "user", content: JSON.stringify(chapterMetadata) },
            { role: "user", content: transcriptDigest.toString() },
            { role: "user", content: timestampedUtterances.toString() }
        ],
        model: "gpt-4o", //midtier model for summarizations
        temperature: 0.0,
        response_format: zodResponseFormat(chapterSchema, "digest"),
    })

    let extractedChapters = completion.choices[0].message.parsed;

    console.log(extractedChapters)
    extractedChapters.chapters.forEach(chapter => {
        chapter.url = `https://www.youtube.com/watch?v=${videoID}&t=${chapter.yt_timestamp}`;
    });
    console.log(extractedChapters)

    extractedChapters["descriptionTextBlob"] = extractedChapters.chapters.map(chapter => chapter.timestamp + " " + chapter.name).join('\n').toString();

    return extractedChapters;
}

async function generateStaticHtml(result, templatePath) {
    const template = fs.readFileSync(templatePath, 'utf-8');
    return template
        .replace('{{videoId}}', result.meta.videoId)
        .replace('{{title}}', result.meta.title)
        .replace('{{author}}', result.meta.author)
        .replace('{{duration}}', result.meta.duration)
        .replace('{{datePublished}}', result.meta.publishedDate)
        .replace('{{dateFetched}}', result.meta.dateFetched)
        .replace('{{sentenceSummary}}', result.transcript_digest.sentence_summary)
        .replace('{{pullQuotes}}', result.transcript_digest.pull_quotes.map(quote => `<li>${quote}</li>`).join(''))
        .replace('{{topics}}', result.transcript_digest.topics.map(topic => `<li>${topic}</li>`).join(''))
        .replace('{{keywords}}', result.transcript_digest.keywords.map(keyword => `<li>${keyword}</li>`).join(''))
        .replace('{{concepts}}', result.transcript_digest.concepts.map(concept => `<li>${concept}</li>`).join(''))
        .replace('{{paragraphSummary}}', result.transcript_digest.paragraph_summary)
        .replace('{{pageSummary}}', marked(result.transcript_digest.page_summary))
        .replace('{{chapters}}', result.transcript_digest.chapters.chapters.map(chapter => `<li onclick="window.open('${chapter.url}', '_blank');">${chapter.timestamp} - ${chapter.name}</li>`).join(''));
}

async function digestYoutubeTranscript(urlOrID) {

    console.log("Extracting video ID from URL...");

    const videoID = extractYoutubeId(urlOrID);
    console.log("  Video ID extracted:", videoID);

    console.log("Fetching transcript JSON...");
    const transcriptObject = await fetchTranscriptJson(videoID);
    console.log("  Transcript JSON fetched:");
    console.log(transcriptObject.toString().slice(0,100));

    console.log("Extracting transcript text...");
    const transcriptText = await extractTranscriptText(transcriptObject);
    console.log("  Transcript text extracted.");
    console.log(transcriptText.slice(0,300));

    console.log("Cleaning transcript text...");
    const cleanedTranscript = await cleanTranscript(transcriptText, transcriptObject.metadata);
    console.log("  Transcript text cleaned.");
    console.log(cleanedTranscript.slice(0,100));

    console.log("Digesting transcript...");
    const transcriptDigest = await digestTranscript(cleanedTranscript, transcriptObject.metadata);
    console.log("  Transcript digested.");
    console.log(transcriptDigest.toString().slice(0,100));

    console.log("Extracting timestamped utterances...");
    const timestampedUtterances = await extractTimestampedUtterances(transcriptObject);
    console.log("  Timestamped utterances extracted.");
    console.log(timestampedUtterances.slice(0,100));

    console.log("Extracting chapters...");
    const chapters = await extractChapters(transcriptDigest, transcriptObject.metadata, timestampedUtterances, videoID);
    console.log("  Chapters extracted.");
    console.log(chapters.toString().slice(0,100));

    const digestedTranscript = {
        meta: {
            ...transcriptObject.metadata,
            dateFetched: new Date().toISOString(),
        },
        transcript_digest: {
            ...transcriptDigest,
            chapters,
        },
        transcript_processing: {
            timestamped_utterances: timestampedUtterances,
            cleaned_transcript: cleanedTranscript,
            transcript_text: transcriptText,
            transcript_object: transcriptObject,
        },
    };

    console.log("Generating static HTML...");
    const html = await generateStaticHtml(digestedTranscript, path.join(__dirname, 'transcript-digest-viewer.html'));

    return {
        ...digestedTranscript,
        html,
    };
}



async function main() {
    // const url = 'https://www.youtube.com/watch?v=1iILtZuj3Yw'; // Replace with the desired YouTube URL
    // const url = 'https://www.youtube.com/watch?v=59Etzj5gvsE'
    // const url = 'https://www.youtube.com/watch?v=XALBGkjkUPQ';
    // const url = 'https://www.youtube.com/watch?v=-2k1rcRzsLA'
    // const url = 'https://youtu.be/VfSQ43VBG28'
    // const url = 'https://www.youtube.com/watch?v=VfSQ43VBG28' // HMN24 - 01 - Intro to Data Collection
    // const url = 'https://www.youtube.com/watch?v=iROSFpum15A' // HMN24 - 03 - Intro to Balance (Center of Mass vs Base of Support)
    // const url = 'https://www.youtube.com/watch?v=ezeMpNFrZ4c' // HMN25 - 2025-01-29 lecture
    // const url = 'https://www.youtube.com/watch?v=T2CxbB5DrAs' // HMN25 -  2025-01-27_14_59.mp4
    const url = 'https://www.youtube.com/watch?v=hCSj2z25rJ8' // HMN25 -  2025-02-03_14_57.mp4


    // INSERT YT ID INTO `youtube-fetcher.js` !!!!


    const videoID = extractYoutubeId(url)

    const result = await digestYoutubeTranscript(videoID);


    //save out to the out directory
    const outPath = path.join(__dirname, 'out', videoID, `transcript-digest_ytid-${videoID}.json`);
    ensureDirectoryExistence(outPath);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

    const htmlPath = path.join(__dirname, 'out', videoID, `transcript-digest_ytid-${videoID}.html`);
    ensureDirectoryExistence(htmlPath);
    fs.writeFileSync(htmlPath, result.html);

    console.log(result);
}

main().catch(console.error);

export default digestYoutubeTranscript;
