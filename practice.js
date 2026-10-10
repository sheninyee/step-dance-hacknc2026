(() => {
    const camera = document.querySelector("#camera");
    async function startCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            say("This browser or connection can't use the camera. Open the page over https or localhost.");
            return;
        }
        try {
            camera.srcObject = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (err) {
            say("Camera not available. Please allow camera access.");
        }
    }

    //const warning = document.querySelector("#camera-warning");
    startCamera();

    
})();
