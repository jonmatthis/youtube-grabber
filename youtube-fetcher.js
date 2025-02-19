import fetch from 'node-fetch';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';
const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
const RE_XML_TRANSCRIPT = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

class YoutubeTranscriptError extends Error {
    constructor(message) {
        super(`[YoutubeTranscript] 🚨 ${message}`);
    }
}

class YoutubeTranscript {
    static async fetchTranscript(videoId) {
        const videoPageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
            headers: { 'User-Agent': USER_AGENT },
        });
        const videoPageBody = await videoPageResponse.text();
        const splittedHTML = videoPageBody.split('"captions":');

        if (splittedHTML.length <= 1) {
            throw new YoutubeTranscriptError('Transcript not available or video is unavailable.');
        }

        const captions = JSON.parse(splittedHTML[1].split(',"videoDetails')[0].replace('\n', '')).playerCaptionsTracklistRenderer;
        if (!captions || !captions.captionTracks) {
            throw new YoutubeTranscriptError('No transcripts available for this video.');
        }

        const transcriptURL = captions.captionTracks[0].baseUrl;
        const transcriptResponse = await fetch(transcriptURL, {
            headers: { 'User-Agent': USER_AGENT },
        });

        if (!transcriptResponse.ok) {
            throw new YoutubeTranscriptError('Failed to fetch transcript.');
        }

        const transcriptBody = await transcriptResponse.text();
        const results = [...transcriptBody.matchAll(RE_XML_TRANSCRIPT)];
        const transcript = results.map(result => ({
            text: result[3],
            duration: parseFloat(result[2]),
            offset: parseFloat(result[1]),
            lang: captions.captionTracks[0].languageCode,
        }));

        const metadata = {
            videoId,
            title: this.extractMetadata(videoPageBody, 'title'),
            author: this.extractMetadata(videoPageBody, 'author'),
            viewCount: this.extractMetadata(videoPageBody, 'viewCount'),
            description: this.extractMetadata(videoPageBody, 'shortDescription'),
            publishedDate: this.extractMetadata(videoPageBody, 'publishDate'),
            channelId: this.extractMetadata(videoPageBody, 'channelId'),
            channelTitle: this.extractMetadata(videoPageBody, 'ownerChannelName'),
            tags: this.extractMetadata(videoPageBody, 'keywords'),
            likeCount: this.extractMetadata(videoPageBody, 'likeCount'),
            dislikeCount: this.extractMetadata(videoPageBody, 'dislikeCount'),
            commentCount: this.extractMetadata(videoPageBody, 'commentCount'),
            duration: this.extractMetadata(videoPageBody, 'lengthSeconds'),
            thumbnailUrl: this.extractMetadata(videoPageBody, 'thumbnailUrl'),
        };

        return { metadata, transcript };
    }

    static retrieveVideoId(videoIdOrUrl) {
        if (videoIdOrUrl.length === 11) {
            return videoIdOrUrl;
        }
        const matchId = videoIdOrUrl.match(RE_YOUTUBE);
        if (matchId && matchId.length) {
            return matchId[1];
        }
        throw new YoutubeTranscriptError('Invalid YouTube video ID or URL.');
    }

    static extractMetadata(html, key) {
        const regex = new RegExp(`"${key}":"(.*?)"`);
        const match = html.match(regex);
        return match ? match[1] : null;
    }
}

export { YoutubeTranscript, YoutubeTranscriptError };

async function main() {
    try {
        const result = await YoutubeTranscript.fetchTranscript('cCBAkRfW8j8');
        console.log(result);
    } catch (error) {
        console.error(error.message);
    }
}

main();
