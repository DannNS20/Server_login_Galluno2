const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');


//const server = '/Users/admin/Documents/pagina_gallos'
const server = '/var/www'


// Rutas base donde se encuentran las carpetas de videos
const videosBasePath1 = `${server}/server_stream/media/live`;
const videosBasePath2 = `${server}/server_stream2/media/live`;
const videosBasePath3 = `${server}/server_stream3/media/live`;
const videoPaths = [videosBasePath1, videosBasePath2, videosBasePath3];

// Endpoint para listar todos los videos
router.get('/todos', (req, res) => {
    try {
        const videoList = [];

        videoPaths.forEach(basePath => {
            if (fs.existsSync(basePath)) {  // Verificar si el path existe
                const folders = fs.readdirSync(basePath);
                console.log('Folders found in', basePath, ':', folders);

                const streamFolders = folders.filter(folder => folder.startsWith('Stream'));
                console.log('Stream folders in', basePath, ':', streamFolders);

                streamFolders.forEach(folder => {
                    const folderPath = path.join(basePath, folder);
                    const files = fs.readdirSync(folderPath).filter(file => file.endsWith('.mp4'));

                    console.log(`Files in ${folderPath}:`, files);

                    files.forEach(file => {
                        videoList.push({
                            folder: folder,
                            name: file,
                            path: basePath
                        });
                    });
                });
            } else {
                console.warn('Path does not exist:', basePath);
            }
        });

        console.log('Video list:', videoList);
        res.json(videoList);
    } catch (error) {
        console.error('Error reading folders or files:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/:folder/:name', (req, res) => {
    const folder = req.params.folder;
    const name = req.params.name;

    let videoPath;

    for (const basePath of videoPaths) {
        videoPath = path.join(basePath, folder, name);
        if (fs.existsSync(videoPath)) {
            const stat = fs.statSync(videoPath);
            const fileSize = stat.size;
            const range = req.headers.range;

            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + (5 * 1024 * 1024) - 1, fileSize - 1);  // Fragmento de 5 MB
                const chunkSize = (end - start) + 1;

                const file = fs.createReadStream(videoPath, { start, end });
                const head = {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunkSize,
                    'Content-Type': 'video/mp4',
                };

                res.writeHead(206, head);
                file.pipe(res);
            } else {
                const head = {
                    'Content-Length': fileSize,
                    'Content-Type': 'video/mp4',
                };

                res.writeHead(200, head);
                fs.createReadStream(videoPath).pipe(res);
            }

            return;
        }
    }

    res.status(404).send('Video not found');
});


router.delete('/:folder/:name', (req, res) => {
    const folder = req.params.folder;
    const name = req.params.name;

    let videoPath;
    for (const basePath of videoPaths) {
        videoPath = path.join(basePath, folder, name);
        if (fs.existsSync(videoPath)) {
            try {
                fs.unlinkSync(videoPath); // Eliminar el archivo de video
                res.status(200).json({ message: 'Video eliminado correctamente' }); // Respuesta en formato JSON
                return;
            } catch (error) {
                console.error('Error deleting video:', error);
                res.status(500).json({ error: 'Internal Server Error' }); // Respuesta en formato JSON
                return;
            }
        }
    }

    res.status(404).json({ error: 'Video no encontrado' }); // Respuesta en formato JSON
});

router.get('/upload/:folder/:name', (req, res) => {
    const folder = req.params.folder;
    const name = req.params.name;
    let videoPath;
    for (const basePath of videoPaths) {
        videoPath = path.join(basePath, folder, name);
        if (fs.existsSync(videoPath)) {
    
        const outputDir = `videos/${folder}`;
        const outputFileName = `${name}.m3u8`;
        const outputPath = path.join(outputDir, outputFileName);

        // Check if output directory exists, create if not
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Command to convert video to HLS format using ffmpeg
        const command = `ffmpeg -i ${videoPath} \
            -map 0:v -c:v libx264 -crf 23 -preset veryfast -g 48 \
            -map 0:v -c:v libx264 -crf 28 -preset veryfast -g 48 \
            -map 0:v -c:v libx264 -crf 32 -preset veryfast -g 48 \
            -map 0:a -c:a aac -b:a 128k \
            -hls_time 10 -hls_playlist_type vod -hls_flags independent_segments -report \
            -f hls ${outputPath}`;

        // Execute ffmpeg command
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`ffmpeg exec error: ${error}`);
                return res.status(500).json({ error: 'Failed to convert video to HLS format' });
            }
            console.log(`stdout: ${stdout}`);
            console.error(`stderr: ${stderr}`);
            const videoUrl = `public/videos/${chapterId}/${outputFileName}`;
            chapters[chapterId] = { videoUrl, title: req.body.title, description: req.body.description }; // Store chapter information
            res.json({ success: true, message: 'Video uploaded and converted to HLS.', chapterId });
        });
        }
    }
});

module.exports = router;