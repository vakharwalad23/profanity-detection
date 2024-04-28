import 'dotenv/config';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import { Index } from '@upstash/vector'


const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 30,
    chunkOverlap: 10,
    separators: [' '] 
});
const PROFANE_THRESHOLD = 0.86
const ALLOWED_WORDS: string[] = []

const { UPSTASH_VECTOR_URL, UPSTASH_VECTOR_TOKEN } = process.env

const app:Express = express()

app.use(cors())
app.use(express.json())

app.get('/helloworld', (request: Request, response: Response) => {
    return response.status(200).json({
        message: 'Hello World'
    })
})

app.post('/', async(request: Request, response: Response) => {
    if(request.headers['content-type'] !== 'application/json') {
        return response.status(400).json({
            message: 'Invalid request'
        })
    }
    try {
        const index = new Index({
            url: UPSTASH_VECTOR_URL,
            token: UPSTASH_VECTOR_TOKEN,
            cache: false
        })
        const body = request.body
        let { text } = body as { text: string }
        if(!text) {
            return response.status(400).json({
                message: 'Invalid request. Text is required'
            })
        }
        text = text
        .split(/\s/)
        .filter((word) => !ALLOWED_WORDS.includes(word.toLocaleLowerCase()))
        .join(' ')

        const semanticChunks = await semanticSplitter(text)
        const chunks = textSplitter(text)

        const flaggedChunks = new Set<{ text: string, score: number }>()

        const vector = await Promise.all([
            ...chunks.map(async (c) => {
                const [v] = await index.query({
                    topK: 1,
                    data: c,
                    includeMetadata: true
                })
                if(v && v.score > 0.90) {
                    flaggedChunks.add({
                        text: v.metadata!.text as string,
                        score: v.score
                    })
                }

                return { score: 0 }
            }),
            ...semanticChunks.map(async (c) => {
                const [v] = await index.query({
                    topK: 1,
                    data: c,
                    includeMetadata: true
                })

                if(v && v.score > PROFANE_THRESHOLD) {
                    flaggedChunks.add({
                        text: v.metadata!.text as string,
                        score: v.score
                    })
                }

                return v!
            }),
        ])

        if(flaggedChunks.size > 0) {
            const sortedChunks = Array.from(flaggedChunks).sort((a, b) => a.score > b.score ? -1 : 1)[0]
            return response.status(200).json({
                isProfane: true,
                score: sortedChunks.score,
                text: sortedChunks.text
            })
        } else {
            const highestProfaneChunk = vector.sort((a, b) => a.score > b.score ? -1 : 1)[0]
            return response.status(200).json({
                isProfane: false,
                score: highestProfaneChunk.score,
            })
        }

    } catch (error) {
        console.error(error)
        return response.status(500).json({
            message: 'An error occurred'
        })
    }
})

app.listen(3000, () => {
    console.log('Server started on port 3000')
})

async function semanticSplitter(text: string): Promise<string[]> {
   if(text.split(/\s/).length === 1) return []
   const doc = await splitter.createDocuments([text])
   const chunks = doc.map((d) => d.pageContent)
   return chunks
}

function textSplitter(text: string): string[] {
    return text.split(/\s/)
}