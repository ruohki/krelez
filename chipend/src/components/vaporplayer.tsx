import { useState, useEffect, useRef } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";

interface Track {
  title: string;
  artist: string;
  timestamp: number;
}

interface TrackHistoryEntry {
  title: string;
  artist: string;
  startedAt: Date;
}

interface VaporPlayerProps {
  endpoint?: string;
}

const VaporPlayer = ({ endpoint }: VaporPlayerProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedVolume = localStorage.getItem('vaporPlayerVolume');
      return savedVolume ? parseFloat(savedVolume) : 0.7;
    }
    return 0.7;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<{ artist: string; title: string } | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [trackHistory, setTrackHistory] = useState<TrackHistoryEntry[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastTrackRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Save volume to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('vaporPlayerVolume', volume.toString());
    }
  }, [volume]);

  // Autoplay setup
  useEffect(() => {
    const startPlayback = async () => {
      if (audioRef.current) {
        try {
          await audioRef.current.play();
          setIsPlaying(true);
        } catch (error) {
          console.error("Autoplay failed:", error);
          setIsPlaying(false);
        }
      }
    };

    startPlayback();
  }, []);

  // Fetch initial metadata
  useEffect(() => {
    const fetchInitialMetadata = async () => {
      try {
        const response = await fetch(`${endpoint}/metadata`);
        const data = await response.json();
        if (data.artist && data.title) {
          setCurrentTrack(data);
          const trackId = `${data.artist}-${data.title}`;
          lastTrackRef.current = trackId;
        }
      } catch (error) {
        console.error('Error fetching initial metadata:', error);
      }
    };

    fetchInitialMetadata();
  }, [endpoint]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Timer management
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = window.setInterval(() => {
        setPlaybackTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isPlaying]);

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Format date to HH:MM
  const formatTimeStamp = (date: Date): string => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  };

  // Set up SSE connection for track updates
  useEffect(() => {
    const setupSSE = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      if (isPlaying) {
        const eventSource = new EventSource(`${endpoint}/live`);
        eventSourceRef.current = eventSource;
        
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.artist && data.title) {
              const trackId = `${data.artist}-${data.title}`;
              
              // Only add to history if it's a new track
              if (lastTrackRef.current !== trackId) {
                // Add the previous track to history if it exists
                if (currentTrack) {
                  setTrackHistory(prev => [{
                    title: currentTrack.title,
                    artist: currentTrack.artist,
                    startedAt: new Date(Date.now() - 1000) // 1 second ago to ensure correct ordering
                  }, ...prev].slice(0, 3)); // Keep last 3 tracks
                }
                
                lastTrackRef.current = trackId;
                setCurrentTrack(data);
              }
            }
          } catch (error) {
            console.error('Error parsing SSE data:', error);
          }
        };

        eventSource.onerror = (error) => {
          console.error('SSE connection error:', error);
          eventSource.close();
          eventSourceRef.current = null;
        };
      }
    };

    setupSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [isPlaying, endpoint, currentTrack]);

  const togglePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(error => {
          console.error("Playback failed:", error);
        });
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
  };

  return (
    <div className="w-full max-w-md mx-auto px-4">
      <div className="bg-gradient-to-br from-pink-300/40 via-fuchsia-400/30 to-purple-500/50 p-4 sm:p-6 rounded-xl shadow-lg backdrop-blur-sm border border-white/10">
        <h1 className="text-2xl sm:text-3xl font-bold text-center mb-4 sm:mb-6 text-white tracking-wider">VAPOR FUNK</h1>
        
        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-white/5 rounded-lg backdrop-blur-sm">
          <p className="text-lg sm:text-xl text-center text-white font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
            {currentTrack ? `${currentTrack.title} - ${currentTrack.artist}` : "Loading..."}
          </p>
        </div>
        
        <div className="flex justify-between items-center mb-4 sm:mb-6 gap-2 sm:gap-4">
          <button 
            onClick={togglePlayPause}
            className="bg-pink-300/50 hover:bg-pink-300/70 p-2 sm:p-3 rounded-lg transition-colors duration-200"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={20} className="text-white" /> : <Play size={20} className="text-white" />}
          </button>
          
          <div className="flex items-center gap-2 sm:gap-4 flex-1">
            <button 
              onClick={toggleMute}
              className="bg-purple-500/50 hover:bg-purple-500/70 p-2 sm:p-3 rounded-lg transition-colors duration-200"
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX size={20} className="text-white" /> : <Volume2 size={20} className="text-white" />}
            </button>
            
            <div className="flex items-center gap-2 flex-1">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={handleVolumeChange}
                className="flex-1 h-2 rounded-lg appearance-none bg-white/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 sm:[&::-webkit-slider-thumb]:w-4 sm:[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-pink-300/90 [&::-webkit-slider-thumb]:cursor-pointer hover:[&::-webkit-slider-thumb]:bg-pink-300/100"
              />
              <span className="text-xs sm:text-sm text-white/90 w-10 sm:w-12 text-right">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </div>
        </div>
        
        <audio 
          ref={audioRef} 
          onEnded={() => {
            setIsPlaying(false);
            setPlaybackTime(0);
          }}
          onError={() => {
            setIsPlaying(false);
            setPlaybackTime(0);
            console.error("Stream connection failed. Please try again later.");
          }}
        >
          <source type="audio/ogg" src={`${endpoint}/stream`} />
        </audio>
        
        <div className="mt-6 sm:mt-8">
          <div className="flex justify-between items-center mb-3 sm:mb-4">
            <h2 className="text-xl sm:text-2xl font-bold text-white">TRACK HISTORY</h2>
            <p className="text-xs sm:text-sm text-white/90">
              {isPlaying ? `Playback time: ${formatTime(playbackTime)}` : "Ready to play"}
            </p>
          </div>
          <div className="bg-white/5 rounded-lg p-3 sm:p-4 backdrop-blur-sm">
            {trackHistory.length > 0 ? (
              <div className="space-y-2">
                {trackHistory.map((track, index) => (
                  <div key={index} className="flex justify-between items-center">
                    <p className="text-sm text-white/80 truncate flex-1">
                      {track.title} - {track.artist}
                    </p>
                    <p className="text-xs sm:text-sm text-pink-300/90 ml-2">
                      {formatTimeStamp(track.startedAt)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-white/60 text-center">No history yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VaporPlayer; 