// app.js
import dotenv from "dotenv";
dotenv.config();

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import {
    S3Client,
    PutObjectCommand
} from '@aws-sdk/client-s3';
import {
    RekognitionClient,
    DetectLabelsCommand
} from '@aws-sdk/client-rekognition';
import {
    fileURLToPath
} from 'url';

const __filename = fileURLToPath(
    import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// AWS Clients
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const rekognitionClient = new RekognitionClient({
    region: process.env.REKOGNITION_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

// Middleware to serve static files (e.g., HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Multer setup (store images temporarily)
const upload = multer({
    dest: 'uploads/'
});

// Serve HTML Form
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload Image and Redirect to Display Page
app.post('/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).send('No image uploaded!');

    try {
        const bucketName = process.env.S3_BUCKET_NAME;
        const imageName = req.file.filename + path.extname(req.file.originalname);

        // Upload image to S3
        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: imageName,
            Body: fs.createReadStream(req.file.path),
            ContentType: req.file.mimetype,
        }));

        console.log(`✅ Image uploaded successfully: ${imageName}`);

        // Detect labels using Rekognition (with bounding boxes)
        const detectParams = {
            Image: {
                S3Object: {
                    Bucket: bucketName,
                    Name: imageName
                }
            },
            MaxLabels: 10,
            MinConfidence: 70.0,
        };

        const response = await rekognitionClient.send(new DetectLabelsCommand(detectParams));

        // Extract bounding boxes and label information
        const labelsWithBoxes = response.Labels.map(label => ({
            name: label.Name,
            confidence: label.Confidence.toFixed(2),
            boxes: label.Instances.map(instance => instance.BoundingBox) || []
        })).filter(label => label.boxes.length > 0); // Keep only labels with bounding boxes

        // Generate S3 image URL
        const imageUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${imageName}`;

        // Clean up local uploaded file
        fs.unlinkSync(req.file.path);

        // Redirect to display page with image, labels, and boxes
        res.redirect(`/display?image=${encodeURIComponent(imageUrl)}&data=${encodeURIComponent(JSON.stringify(labelsWithBoxes))}`);

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).send('Error processing image.');
    }
});

// Serve the display page
app.get('/display', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
});