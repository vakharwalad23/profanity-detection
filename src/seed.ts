import 'dotenv/config';
import { Index } from '@upstash/vector'
import csv from 'csv-parser';
import fs from 'fs';
import { Transform } from 'stream'


const index = new Index({
    url: process.env.UPSTASH_VECTOR_URL as string,
    token: process.env.UPSTASH_VECTOR_TOKEN as string,
})

const lineToJSONStreamRange = (startLine: number, endLine: number) => {
    let currentLine = 0;
    return new Transform({
        objectMode: true,
        transform(chunk, encoding, callback) {
            if (currentLine >= startLine && currentLine < endLine) {
                this.push(chunk)
            }
            currentLine++;
            if(currentLine >= endLine) {
                this.push(null)
            }
            callback();
        }
    })
}

interface Row {
    text: string
}

const parseCSV = async (filePath: string, startLine: number, endLine: number): Promise<Row[]> => {
    return new Promise((resolve, reject) => {
    const rows: Row[] = []
    
    fs.createReadStream(filePath)
        .pipe(csv({ separator: ',' }))
        .pipe(lineToJSONStreamRange(startLine, endLine))
        .on('data', (data) => rows.push(data))
        .on('error', (error) => {
            console.error(error)
            reject(error)
        })
        .on('end', async () => {
            console.log('CSV file successfully processed from line', startLine, 'to', endLine, 'with', rows.length, 'rows.');
            resolve(rows)
        });
    });
}

const STEP = 30
const seed = async () => {
    for (let i = 0; i < 1464; i += STEP) {
        const rows = await parseCSV('pre-swears.csv', i, i + STEP)

        const data = rows.map((row, index) => ({
            id: i + index,
            data: row.text,
            metadata: { text: row.text }
        }))
        console.log('Upserting', data.length, 'rows.')
        await index.upsert(data)
    }
}

seed()