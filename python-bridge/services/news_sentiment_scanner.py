"""
news_sentiment_scanner.py
Deduplicated News Sentiment scoring engine using financial keyword patterns with a
plug-and-play local FinBERT transformer fallback.
"""
import logging

log = logging.getLogger("news_sentiment_scanner")

class NewsSentimentScanner:
    def __init__(self):
        self.use_transformer = False
        self.tokenizer = None
        self.model = None
        
        # Try loading transformer model lazily or when requested to save startup memory
        try:
            import torch
            from transformers import AutoTokenizer, AutoModelForSequenceClassification
            # Only enable if user explicitly triggers or weights are cached
            self.tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert", local_files_only=True)
            self.model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert", local_files_only=True)
            self.use_transformer = True
            log.info("Loaded pre-cached local FinBERT model successfully.")
        except Exception:
            log.info("FinBERT local weights not detected. Defaulting to high-performance financial lexicon matcher.")

    def analyze_sentiment(self, text: str) -> dict:
        """
        Analyzes the input text and returns positive/negative/neutral probability scores.
        """
        if not text:
            return {"positive": 0.0, "negative": 0.0, "neutral": 1.0, "verdict": "neutral"}
            
        if self.use_transformer and self.tokenizer and self.model:
            try:
                import torch
                inputs = self.tokenizer(text, return_tensors="pt", padding=True, truncation=True)
                outputs = self.model(**inputs)
                probs = torch.nn.functional.softmax(outputs.logits, dim=-1).detach().numpy()[0]
                verdicts = ["positive", "negative", "neutral"]
                idx = probs.argmax()
                return {
                    "positive": float(probs[0]),
                    "negative": float(probs[1]),
                    "neutral": float(probs[2]),
                    "verdict": verdicts[idx]
                }
            except Exception as e:
                log.warning(f"FinBERT inference failed: {e}. Falling back to lexicon matcher.")

        # High-performance financial lexical analyzer
        pos_words = {
            "growth", "surge", "gain", "profit", "increase", "rise", "beat", "positive",
            "acquisition", "expansion", "partnership", "deal", "agreement", "contract",
            "dividend", "upgrade", "buy", "bullish", "record-high", "high-margin", "revenue",
            "outperform", "success", "boost"
        }
        neg_words = {
            "drop", "fall", "loss", "decline", "slump", "negative", "warns", "recession",
            "downgrade", "sell", "bearish", "crash", "hike", "cut", "missing", "deficit",
            "sanctions", "tariff", "dispute", "investigation", "fined", "weak", "plunge"
        }
        
        words = text.lower().split()
        pos_count = sum(1 for w in words if w in pos_words)
        neg_count = sum(1 for w in words if w in neg_words)
        
        total = pos_count + neg_count
        if total == 0:
            return {"positive": 0.1, "negative": 0.1, "neutral": 0.8, "verdict": "neutral"}
            
        pos_pct = pos_count / total
        neg_pct = neg_count / total
        
        if pos_count > neg_count:
            return {"positive": round(pos_pct, 2), "negative": round(neg_pct * 0.5, 2), "neutral": round((1 - pos_pct - neg_pct*0.5), 2), "verdict": "positive"}
        elif neg_count > pos_count:
            return {"positive": round(pos_pct * 0.5, 2), "negative": round(neg_pct, 2), "neutral": round((1 - pos_pct*0.5 - neg_pct), 2), "verdict": "negative"}
        else:
            return {"positive": 0.3, "negative": 0.3, "neutral": 0.4, "verdict": "neutral"}

sentiment_scanner = NewsSentimentScanner()
