import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Trophy, Star, Zap, Target, ChevronRight, Check, X, Clock,
    Award, Flame, RefreshCw, ArrowRight, BookOpen, Brain, Building2, Globe
} from 'lucide-react';
import { quizEngine, QuizQuestion, UserProgress } from '../../services/QuizEngine';

interface InteractiveQuizProps {
    onClose?: () => void;
}

export const InteractiveQuiz: React.FC<InteractiveQuizProps> = ({ onClose }) => {
    const [mode, setMode] = useState<'menu' | 'quiz' | 'results'>('menu');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [questions, setQuestions] = useState<QuizQuestion[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
    const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
    const [score, setScore] = useState(0);
    const [correctAnswers, setCorrectAnswers] = useState(0);
    const [startTime, setStartTime] = useState<number>(0);
    const [progress, setProgress] = useState<UserProgress>({
        totalXP: 0,
        currentStreak: 0,
        longestStreak: 0,
        quizzesCompleted: 0,
        categoryProgress: {},
        lastQuizDate: null,
        badges: [],
    });

    // Load progress on mount
    useEffect(() => {
        const load = async () => {
            const saved = await quizEngine.loadProgress();
            setProgress(saved);
        };
        load();
    }, []);

    const categories = quizEngine.getCategories();
    const badges = quizEngine.getBadges();

    const categoryIcons: Record<string, React.ElementType> = {
        fundamentals: BookOpen,
        technical: Target,
        psychology: Brain,
        tax: Building2,
        macros: Globe,
    };

    const startQuiz = (categoryId: string) => {
        setSelectedCategory(categoryId);
        setQuestions(quizEngine.getQuestions(categoryId, undefined, 5));
        setCurrentIndex(0);
        setScore(0);
        setCorrectAnswers(0);
        setSelectedAnswer(null);
        setIsAnswerRevealed(false);
        setStartTime(Date.now());
        setMode('quiz');
    };

    const handleAnswerSelect = (index: number) => {
        if (isAnswerRevealed) return;
        setSelectedAnswer(index);
    };

    const handleSubmitAnswer = () => {
        if (selectedAnswer === null) return;

        const question = questions[currentIndex];
        const isCorrect = selectedAnswer === question.correctIndex;

        if (isCorrect) {
            setScore(score + question.points);
            setCorrectAnswers(correctAnswers + 1);
        }

        setIsAnswerRevealed(true);
    };

    const handleNextQuestion = async () => {
        if (currentIndex + 1 >= questions.length) {
            // Quiz complete - calculate results
            const timeTaken = Math.floor((Date.now() - startTime) / 1000);
            const xpEarned = quizEngine.calculateXP(correctAnswers, questions.length, timeTaken);

            const result = {
                quizId: `quiz_${Date.now()}`,
                score,
                totalPoints: questions.reduce((sum, q) => sum + q.points, 0),
                correctAnswers,
                totalQuestions: questions.length,
                timeTaken,
                completedAt: new Date().toISOString(),
                xpEarned,
            };

            const newProgress = await quizEngine.recordResult(result);
            setProgress(newProgress);
            setMode('results');
        } else {
            setCurrentIndex(currentIndex + 1);
            setSelectedAnswer(null);
            setIsAnswerRevealed(false);
        }
    };

    const currentQuestion = questions[currentIndex];
    const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);

    // Menu Screen
    if (mode === 'menu') {
        return (
            <div className="space-y-6">
                {/* Header with XP */}
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 text-white">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-black">Knowledge Arena</h2>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1 bg-white/20 px-3 py-1 rounded-full">
                                <Flame size={16} className="text-orange-300" />
                                <span className="font-bold">{progress.currentStreak} day streak</span>
                            </div>
                            <div className="flex items-center gap-1 bg-white/20 px-3 py-1 rounded-full">
                                <Star size={16} className="text-yellow-300" />
                                <span className="font-bold">{progress.totalXP} XP</span>
                            </div>
                        </div>
                    </div>
                    <p className="text-indigo-200">Test your investing knowledge and earn XP!</p>
                </div>

                {/* Badges */}
                {progress.badges.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-3 flex items-center gap-2">
                            <Award size={16} className="text-amber-500" />
                            Your Badges
                        </h3>
                        <div className="flex flex-wrap gap-2">
                            {badges.filter(b => progress.badges.includes(b.id)).map(badge => (
                                <div
                                    key={badge.id}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-full"
                                    title={badge.description}
                                >
                                    <span>{badge.icon}</span>
                                    <span className="text-xs font-bold text-amber-700 dark:text-amber-300">{badge.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Category Selection */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {categories.map(cat => {
                        const Icon = categoryIcons[cat.id] || BookOpen;
                        return (
                            <button
                                key={cat.id}
                                onClick={() => startQuiz(cat.id)}
                                className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-left hover:border-indigo-500 hover:shadow-lg transition-all group"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="p-3 bg-indigo-500/10 rounded-xl">
                                        <Icon size={24} className="text-indigo-500" />
                                    </div>
                                    <span className="text-2xl">{cat.icon}</span>
                                </div>
                                <h3 className="font-bold text-slate-800 dark:text-white mb-1">{cat.name}</h3>
                                <p className="text-xs text-slate-500 mb-3">{cat.questionCount} questions available</p>
                                <div className="flex items-center gap-1 text-indigo-500 text-sm font-bold group-hover:translate-x-1 transition-transform">
                                    Start Quiz <ChevronRight size={16} />
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-4">
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center">
                        <p className="text-2xl font-black text-indigo-600">{progress.quizzesCompleted}</p>
                        <p className="text-xs text-slate-500">Quizzes Done</p>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center">
                        <p className="text-2xl font-black text-emerald-600">{progress.totalXP}</p>
                        <p className="text-xs text-slate-500">Total XP</p>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center">
                        <p className="text-2xl font-black text-amber-600">{progress.currentStreak}</p>
                        <p className="text-xs text-slate-500">Day Streak</p>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center">
                        <p className="text-2xl font-black text-purple-600">{progress.badges.length}</p>
                        <p className="text-xs text-slate-500">Badges Earned</p>
                    </div>
                </div>
            </div>
        );
    }

    // Quiz Screen
    if (mode === 'quiz' && currentQuestion) {
        return (
            <div className="max-w-2xl mx-auto">
                {/* Progress Bar */}
                <div className="mb-6">
                    <div className="flex items-center justify-between text-sm mb-2">
                        <span className="font-bold text-slate-700 dark:text-white">
                            Question {currentIndex + 1} of {questions.length}
                        </span>
                        <span className="flex items-center gap-2">
                            <Star size={14} className="text-amber-500" />
                            <span className="font-bold text-amber-600">{score} pts</span>
                        </span>
                    </div>
                    <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-indigo-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
                        />
                    </div>
                </div>

                {/* Question Card */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={currentQuestion.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 mb-6"
                    >
                        {/* Difficulty Badge */}
                        <div className="flex items-center justify-between mb-4">
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase ${currentQuestion.difficulty === 'beginner' ? 'bg-emerald-100 text-emerald-700' :
                                currentQuestion.difficulty === 'intermediate' ? 'bg-amber-100 text-amber-700' :
                                    'bg-rose-100 text-rose-700'
                                }`}>
                                {currentQuestion.difficulty}
                            </span>
                            <span className="text-xs font-bold text-indigo-500">+{currentQuestion.points} pts</span>
                        </div>

                        {/* Question */}
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-6">
                            {currentQuestion.question}
                        </h3>

                        {/* Options */}
                        <div className="space-y-3">
                            {currentQuestion.options.map((option, idx) => {
                                const isSelected = selectedAnswer === idx;
                                const isCorrect = idx === currentQuestion.correctIndex;

                                let optionClass = 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-500';

                                if (isAnswerRevealed) {
                                    if (isCorrect) {
                                        optionClass = 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-500 text-emerald-700 dark:text-emerald-400';
                                    } else if (isSelected && !isCorrect) {
                                        optionClass = 'bg-rose-50 dark:bg-rose-900/30 border-rose-500 text-rose-700 dark:text-rose-400';
                                    }
                                } else if (isSelected) {
                                    optionClass = 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-500 text-indigo-700 dark:text-indigo-400';
                                }

                                return (
                                    <button
                                        key={idx}
                                        onClick={() => handleAnswerSelect(idx)}
                                        disabled={isAnswerRevealed}
                                        className={`w-full p-4 rounded-xl border-2 text-left font-medium transition-all ${optionClass}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="w-8 h-8 flex items-center justify-center bg-slate-200 dark:bg-slate-700 rounded-lg text-sm font-bold">
                                                {String.fromCharCode(65 + idx)}
                                            </span>
                                            <span>{option}</span>
                                            {isAnswerRevealed && isCorrect && <Check size={18} className="ml-auto text-emerald-500" />}
                                            {isAnswerRevealed && isSelected && !isCorrect && <X size={18} className="ml-auto text-rose-500" />}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Explanation */}
                        {isAnswerRevealed && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="mt-6 p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl"
                            >
                                <p className="text-sm text-indigo-800 dark:text-indigo-300">
                                    <span className="font-bold">💡 Explanation:</span> {currentQuestion.explanation}
                                </p>
                            </motion.div>
                        )}
                    </motion.div>
                </AnimatePresence>

                {/* Action Button */}
                <div className="flex justify-end">
                    {!isAnswerRevealed ? (
                        <button
                            onClick={handleSubmitAnswer}
                            disabled={selectedAnswer === null}
                            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold rounded-xl transition-all"
                        >
                            Submit Answer
                        </button>
                    ) : (
                        <button
                            onClick={handleNextQuestion}
                            className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all"
                        >
                            {currentIndex + 1 >= questions.length ? 'View Results' : 'Next Question'}
                            <ArrowRight size={18} />
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // Results Screen
    if (mode === 'results') {
        const accuracy = Math.round((correctAnswers / questions.length) * 100);
        const xpEarned = quizEngine.calculateXP(correctAnswers, questions.length, Math.floor((Date.now() - startTime) / 1000));

        return (
            <div className="max-w-xl mx-auto text-center">
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8"
                >
                    {/* Trophy */}
                    <div className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center mb-6 ${accuracy >= 80 ? 'bg-amber-100' : accuracy >= 50 ? 'bg-emerald-100' : 'bg-slate-100'
                        }`}>
                        <Trophy size={48} className={
                            accuracy >= 80 ? 'text-amber-500' : accuracy >= 50 ? 'text-emerald-500' : 'text-slate-400'
                        } />
                    </div>

                    <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-2">
                        {accuracy >= 80 ? 'Excellent!' : accuracy >= 50 ? 'Good Job!' : 'Keep Learning!'}
                    </h2>
                    <p className="text-slate-500 mb-6">You scored {score} out of {totalPoints} points</p>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-3 gap-4 mb-6">
                        <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                            <p className="text-2xl font-black text-emerald-600">{correctAnswers}/{questions.length}</p>
                            <p className="text-xs text-slate-500">Correct</p>
                        </div>
                        <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
                            <p className="text-2xl font-black text-indigo-600">{accuracy}%</p>
                            <p className="text-xs text-slate-500">Accuracy</p>
                        </div>
                        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
                            <p className="text-2xl font-black text-amber-600">+{xpEarned}</p>
                            <p className="text-xs text-slate-500">XP Earned</p>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3">
                        <button
                            onClick={() => setMode('menu')}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-white font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                        >
                            <RefreshCw size={18} />
                            Back to Menu
                        </button>
                        <button
                            onClick={() => startQuiz(selectedCategory!)}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all"
                        >
                            <Zap size={18} />
                            Try Again
                        </button>
                    </div>
                </motion.div>
            </div>
        );
    }

    return null;
};

export default InteractiveQuiz;
