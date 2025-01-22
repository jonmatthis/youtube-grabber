To integrate this functionality into a NestJS application, you should consider the following steps:

1. **Create a Service**: Encapsulate the `YoutubeTranscript` logic within a NestJS service.
2. **Dependency Injection**: Use dependency injection to manage the service.
3. **Module Setup**: Ensure the service is provided in a module.
4. **Controller**: Optionally, create a controller to expose the functionality via HTTP endpoints.

Here is an example of how you can prepare the `YoutubeTranscript` functionality to fit into a NestJS service:

### 1. Create a Service

Create a new service file, e.g., `youtube-transcript.service.ts`.

```typescript
import { Injectable } from '@nestjs/common';
import fetch from 'node-fetch';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';
const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
const RE_XML_TRANSCRIPT = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

class YoutubeTranscriptError extends Error {
    constructor(message: string) {
        super(`[YoutubeTranscript] 🚨 ${message}`);
    }
}

@Injectable()
export class YoutubeTranscriptService {
    async fetchTranscript(videoIdOrUrl: string) {
        const videoId = this.retrieveVideoId(videoIdOrUrl);
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

    private retrieveVideoId(videoIdOrUrl: string): string {
        if (videoIdOrUrl.length === 11) {
            return videoIdOrUrl;
        }
        const matchId = videoIdOrUrl.match(RE_YOUTUBE);
        if (matchId && matchId.length) {
            return matchId[1];
        }
        throw new YoutubeTranscriptError('Invalid YouTube video ID or URL.');
    }

    private extractMetadata(html: string, key: string): string | null {
        const regex = new RegExp(`"${key}":"(.*?)"`);
        const match = html.match(regex);
        return match ? match[1] : null;
    }
}
```

### 2. Module Setup

Create a module file, e.g., `youtube-transcript.module.ts`.

```typescript
import { Module } from '@nestjs/common';
import { YoutubeTranscriptService } from './youtube-transcript.service';

@Module({
    providers: [YoutubeTranscriptService],
    exports: [YoutubeTranscriptService],
})
export class YoutubeTranscriptModule {}
```

### 3. Controller (Optional)

Create a controller file, e.g., `youtube-transcript.controller.ts`.

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { YoutubeTranscriptService } from './youtube-transcript.service';

@Controller('youtube-transcript')
export class YoutubeTranscriptController {
    constructor(private readonly youtubeTranscriptService: YoutubeTranscriptService) {}

    @Get()
    async getTranscript(@Query('videoIdOrUrl') videoIdOrUrl: string) {
        return this.youtubeTranscriptService.fetchTranscript(videoIdOrUrl);
    }
}
```

### 4. Import Module in App Module

Update your `app.module.ts` to include the new module.

```typescript
import { Module } from '@nestjs/common';
import { YoutubeTranscriptModule } from './youtube-transcript/youtube-transcript.module';

@Module({
    imports: [YoutubeTranscriptModule],
})
export class AppModule {}
```

These steps will help you integrate the `YoutubeTranscript` functionality into your NestJS application, making it behave nicely in a services ecosystem.