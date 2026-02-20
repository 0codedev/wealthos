import { useState, useRef, useCallback } from 'react';

/**
 * useVoiceRecorder - Native Audio Harvester
 * Uses MediaRecorder API for stable, high-quality audio capture.
 * Perfect for Gemini 2.5 Flash Native Audio processing.
 */
export const useVoiceRecorder = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [error, setError] = useState<string | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const isRecordingRef = useRef(false);


    const [volume, setVolume] = useState(0);

    const startRecording = useCallback(async () => {
        try {
            setAudioBlob(null);
            setVolume(0);
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // --- HARDWARE DIAGNOSTIC ---
            stream.getTracks().forEach(track => {
                console.log(`🎤 Hardware Device: ${track.label}`);
                console.log(`🎤 Track Status - Enabled: ${track.enabled}, Muted: ${track.muted}, State: ${track.readyState}`);
            });

            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            await audioContext.resume(); // Force resume
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            source.connect(analyser);
            analyser.fftSize = 256;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            const checkVolume = () => {
                analyser.getByteFrequencyData(dataArray);
                const currentVolume = dataArray.reduce((a, b) => a + b) / dataArray.length;
                setVolume(currentVolume);
                if (isRecordingRef.current) requestAnimationFrame(checkVolume);
            };


            // -----------------------

            const options = { mimeType: 'audio/webm;codecs=opus' };
            const recorder = new MediaRecorder(stream, options);
            
            chunksRef.current = [];
            isRecordingRef.current = true;
            checkVolume();

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
                console.log(`🎤 Final File: ${blob.size} bytes`);
                setAudioBlob(blob);
                stream.getTracks().forEach(track => track.stop());
                audioContext.close();
            };

            recorder.start(1000);


            mediaRecorderRef.current = recorder;
            setIsRecording(true);
            setError(null);
            console.log('🎤 Native Audio: Recording started');
        } catch (err: unknown) {
            console.error('🎤 Native Audio Error:', err);
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
        }
    }, []);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording) {
            isRecordingRef.current = false;
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            console.log('🎤 Native Audio: Recording stopped');
        }
    }, [isRecording]);


    return {
        isRecording,
        audioBlob,
        error,
        volume,
        startRecording,
        stopRecording
    };

};
