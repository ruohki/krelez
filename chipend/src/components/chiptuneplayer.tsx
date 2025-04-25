import { useState, useEffect, useRef } from "react";
import { Play, Pause, Volume2, VolumeX, HelpCircle } from "lucide-react";

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

interface ChiptunePlayerProps {
  endpoint?: string;
  apiBaseUrl?: string;
}

const ChiptunePlayer = ({ endpoint }: ChiptunePlayerProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const [volume, setVolume] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedVolume = localStorage.getItem('chiptunePlayerVolume');
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
  const titleRef = useRef<HTMLParagraphElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Save volume to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('chiptunePlayerVolume', volume.toString());
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
  let pollingInterval: NodeJS.Timeout | null = null;
  let isUnmounted = false;

  const fetchAndUpdateTrack = async () => {
    if (!isPlaying) return;
    try {
      const response = await fetch(`${endpoint}/metadata`);
      const data = await response.json();
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
      if (!isUnmounted) {
        console.error('Error polling metadata:', error);
      }
    }
  };

  if (isPlaying) {
    fetchAndUpdateTrack(); // Fetch immediately
    pollingInterval = setInterval(fetchAndUpdateTrack, 5000);
  }

  return () => {
    isUnmounted = true;
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
  };
}, [isPlaying, endpoint, currentTrack]);

  // Check if text needs animation
  useEffect(() => {
    const checkOverflow = () => {
      if (titleRef.current && containerRef.current) {
        const isOverflowing = titleRef.current.scrollWidth > containerRef.current.clientWidth;
        setShouldAnimate(isOverflowing);
      }
    };

    checkOverflow();
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [currentTrack]);

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
    <div className="w-full max-w-md sm:max-w-xl mx-auto px-4">
      <div className="pixel-border bg-gray-800/90 p-4 sm:p-6">
        <h1 className="pixel-text text-2xl sm:text-3xl text-center mb-4 sm:mb-6 text-purple-400">CHIPTUNE PLAYER</h1>
        
        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-gray-900/90 pixel-inset">
          <div ref={containerRef} className="marquee-container">
            <p ref={titleRef} className={`pixel-text text-lg sm:text-xl text-center text-green-400 ${shouldAnimate ? 'animate' : ''} marquee-text`}>
              <span>{currentTrack ? `${currentTrack.title} - ${currentTrack.artist}` : "Loading..."}</span>
              {shouldAnimate && (
                <>
                  <span>{currentTrack ? `${currentTrack.title} - ${currentTrack.artist}` : "Loading..."}</span>
                  <span>{currentTrack ? `${currentTrack.title} - ${currentTrack.artist}` : "Loading..."}</span>
                  <span>{currentTrack ? `${currentTrack.title} - ${currentTrack.artist}` : "Loading..."}</span>
                </>
              )}
            </p>
          </div>
        </div>
        
        <div className="flex justify-between items-center mb-4 sm:mb-6 gap-2 sm:gap-4">
          <button 
            onClick={togglePlayPause}
            className="pixel-button bg-purple-700 hover:bg-purple-600 p-2 sm:p-3"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          
          <div className="flex items-center gap-2 sm:gap-4 flex-1">
            <button 
              onClick={toggleMute}
              className="pixel-button bg-gray-700 hover:bg-gray-600 p-2 sm:p-3 shrink-0"
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            
            <div className="flex items-center gap-1 sm:gap-2 flex-1 min-w-0">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={handleVolumeChange}
                className="pixel-slider w-full"
              />
              <span className="pixel-text text-xs sm:text-sm text-purple-400 w-8 sm:w-12 text-right shrink-0">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </div>
          
          {/* <button 
            onClick={() => console.log("Help clicked")}
            className="pixel-button bg-gray-700 hover:bg-gray-600 p-3"
            aria-label="Help"
          >
            <HelpCircle size={24} />
          </button> */}
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
          <source src={`${endpoint}/stream`} type="audio/ogg" />
          <source src={`${endpoint}/stream.mp3`} type="audio/mpeg" />
        </audio>
        
        <div className="mt-6 sm:mt-8">
          <div className="flex justify-between items-center mb-3 sm:mb-4">
            <h2 className="pixel-text text-xl sm:text-2xl text-purple-400">TRACK HISTORY</h2>
            <p className="pixel-text text-xs sm:text-sm text-purple-400">
              {isPlaying ? `Playback time: ${formatTime(playbackTime)}` : "Ready to play"}
            </p>
          </div>
          <div className="pixel-inset bg-gray-900/90 p-3 sm:p-4">
            {trackHistory.length > 0 ? (
              <div className="space-y-2">
                {trackHistory.map((track, index) => (
                  <div key={index} className="flex justify-between items-center">
                    <p className="pixel-text text-sm text-gray-400 truncate flex-1">
                      {track.title} - {track.artist}
                    </p>
                    <p className="pixel-text text-xs sm:text-sm text-purple-400 ml-2">
                      {formatTimeStamp(track.startedAt)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="pixel-text text-gray-500 text-center">No history yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChiptunePlayer;
