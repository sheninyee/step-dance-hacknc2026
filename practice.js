(() => {
    // Partly Referenced from Source: https://dev.to/koolkamalkishor/recording-videos-using-javascript-and-browser-apis-302k
    
    const camera = document.querySelector("#camera");
    const videoElement = document.getElementById('video');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const recordedVideoElement = document.getElementById('recordedVideo');
    const downloadLink = document.getElementById('downloadLink');

    let mediaRecorder;
    let recordedChunks = [];

    
    function say(text) {
        if (!('speechSynthesis' in window)) return;
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }

    async function startCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            say("This browser or connection can't use the camera. Open the page over https or localhost.");
            return;
        }
        try {
            // Access webcam
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            camera.srcObject = stream;

            mediaRecorder = new MediaRecorder(stream);

            // When data becomes available, store it
            mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) recordedChunks.push(event.data);
            };

            // When recording stops, create a video blob and show it
            mediaRecorder.onstop = () => {
            const videoURL = URL.createObjectURL(new Blob(recordedChunks, { type: 'video/webm' }));
            recordedVideoElement.src = videoURL;
            recordedVideoElement.hidden = false;
            downloadLink.href = videoURL;
            downloadLink.hidden = false;
            };
            startButton.disabled = false;
        } catch (error) {
            say('Camera not available. Please allow camera access.');
        }
    }

    
        // Start recording
    startButton.addEventListener('click', () => {
      recordedChunks = [];
      mediaRecorder.start();
      startButton.disabled = true;
      stopButton.disabled = false;
    });

    // Stop recording
    stopButton.addEventListener('click', () => {
      mediaRecorder.stop();
      startButton.disabled = false;
      stopButton.disabled = true;
    });

    // Initialize the video stream
    //startVideoStream();

    //const warning = document.querySelector("#camera-warning");
    startCamera();

    
})();
