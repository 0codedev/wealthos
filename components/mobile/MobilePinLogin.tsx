import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { ShieldAlert, Delete, ScanFace } from 'lucide-react';

export const MobilePinLogin: React.FC = () => {
    const { login, unlock, isLocked, isAuthenticated } = useAuth();
    const [pin, setPin] = useState('');
    const [error, setError] = useState(false);

    // Auto-submit when PIN is 4 digits
    useEffect(() => {
        if (pin.length === 4) {
            handlePinSubmit(pin);
        }
    }, [pin]);

    const handlePinSubmit = async (submittedPin: string) => {
        let result: { success: boolean; error?: string } = { success: false };
        if (!isAuthenticated) {
            result = await login(submittedPin);
        } else if (isLocked) {
            result = await unlock(submittedPin);
        }

        if (!result.success) {
            setError(true);
            setTimeout(() => {
                setPin('');
                setError(false);
            }, 500); // Reset after shake animation
        }
    };

    const handleNumberClick = (num: string) => {
        if (pin.length < 4) {
            setPin(prev => prev + num);
            setError(false);
        }
    };

    const handleDelete = () => {
        setPin(prev => prev.slice(0, -1));
        setError(false);
    };

    const renderDot = (index: number) => {
        const isFilled = pin.length > index;
        return (
            <div
                key={index}
                className={`w-4 h-4 rounded-full mx-2 transition-all duration-200 ${isFilled
                    ? 'bg-white scale-110 shadow-[0_0_10px_rgba(255,255,255,0.5)]'
                    : 'bg-slate-800'
                    } ${error ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]' : ''}`}
            />
        );
    };

    const renderKeypadButton = (num: string) => (
        <button
            key={num}
            onClick={() => handleNumberClick(num)}
            className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-light text-white active:bg-slate-800 transition-colors focus:outline-none"
        >
            {num}
        </button>
    );

    return (
        <div className="flex flex-col h-[100dvh] w-full bg-slate-950 text-slate-50 font-sans overflow-hidden">

            {/* Top Area: Logo & Text */}
            <div className="flex-1 flex flex-col items-center justify-center px-6">
                <div className="mb-8 w-14 h-14 rounded-full bg-slate-900/50 border border-slate-800 flex items-center justify-center">
                    <ShieldAlert className="w-6 h-6 text-indigo-500" />
                </div>

                <h1 className="text-slate-400 text-lg font-medium mb-2 tracking-wide">
                    {isAuthenticated && isLocked ? 'Session Locked' : 'Welcome Back'}
                </h1>

                <h2 className="text-3xl font-bold text-white mb-12">
                    Enter PIN
                </h2>

                {/* PIN Dots */}
                <div className={`flex items-center justify-center h-8 ${error ? 'animate-shake' : ''}`}>
                    {[0, 1, 2, 3].map(renderDot)}
                </div>
            </div>

            {/* Bottom Area: Keypad */}
            <div className="pb-12 pt-6 px-8 max-w-[400px] w-full mx-auto self-center">
                <div className="grid grid-cols-3 gap-y-4 gap-x-8 justify-items-center">
                    {/* Row 1 */}
                    {['1', '2', '3'].map(renderKeypadButton)}
                    {/* Row 2 */}
                    {['4', '5', '6'].map(renderKeypadButton)}
                    {/* Row 3 */}
                    {['7', '8', '9'].map(renderKeypadButton)}

                    {/* Row 4: Biometric, 0, Backspace */}
                    <button className="w-20 h-20 rounded-full flex items-center justify-center text-slate-500 hover:text-white active:bg-slate-800 transition-colors focus:outline-none">
                        <ScanFace className="w-8 h-8" />
                    </button>
                    {renderKeypadButton('0')}
                    <button
                        onClick={handleDelete}
                        className="w-20 h-20 rounded-full flex items-center justify-center text-slate-500 hover:text-white active:bg-slate-800 transition-colors focus:outline-none"
                    >
                        <Delete className="w-8 h-8" />
                    </button>
                </div>
            </div>

        </div>
    );
};
