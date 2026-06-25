import os
import sys

# Ensure parent directory is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import MarketDataFeedV3_pb2 as pb

def main():
    fixtures_dir = os.path.join(os.path.dirname(__file__), "fixtures", "ws_frames")
    os.makedirs(fixtures_dir, exist_ok=True)
    
    # 1. ltpc mode fixture
    feed_response_ltpc = pb.FeedResponse()
    feed_response_ltpc.type = pb.Type.live_feed
    feed_response_ltpc.currentTs = 1685790000000
    
    feed_ltpc = feed_response_ltpc.feeds["NSE_EQ|INE002A01018"]
    feed_ltpc.requestMode = pb.RequestMode.ltpc
    feed_ltpc.ltpc.ltp = 570.4
    feed_ltpc.ltpc.ltt = 1685790000000
    feed_ltpc.ltpc.ltq = 100
    feed_ltpc.ltpc.cp = 565.0
    
    with open(os.path.join(fixtures_dir, "ltpc.bin"), "wb") as f:
        f.write(feed_response_ltpc.SerializeToString())
    print("Created ltpc.bin")
    
    # 2. option_greeks mode fixture
    feed_response_greeks = pb.FeedResponse()
    feed_response_greeks.type = pb.Type.live_feed
    feed_response_greeks.currentTs = 1685790000000
    
    feed_greeks = feed_response_greeks.feeds["NSE_FO|54321"]
    feed_greeks.requestMode = pb.RequestMode.option_greeks
    
    # populate firstLevelWithGreeks
    flg = feed_greeks.firstLevelWithGreeks
    flg.ltpc.ltp = 15.5
    flg.ltpc.ltt = 1685790000000
    flg.ltpc.ltq = 2500
    flg.ltpc.cp = 14.8
    
    flg.firstDepth.bidQ = 5000
    flg.firstDepth.bidP = 15.45
    flg.firstDepth.askQ = 2500
    flg.firstDepth.askP = 15.5
    
    flg.optionGreeks.delta = 0.45
    flg.optionGreeks.theta = -0.05
    flg.optionGreeks.gamma = 0.02
    flg.optionGreeks.vega = 0.12
    flg.optionGreeks.rho = 0.01
    
    flg.vtt = 1250000
    flg.oi = 450000.0
    flg.iv = 0.22
    
    with open(os.path.join(fixtures_dir, "greeks.bin"), "wb") as f:
        f.write(feed_response_greeks.SerializeToString())
    print("Created greeks.bin")
    
    # 3. full (full_d5) mode fixture
    feed_response_full = pb.FeedResponse()
    feed_response_full.type = pb.Type.live_feed
    feed_response_full.currentTs = 1685790000000
    
    feed_full = feed_response_full.feeds["NSE_EQ|INE002A01018"]
    feed_full.requestMode = pb.RequestMode.full_d5
    
    # populate fullFeed -> marketFF
    mff = feed_full.fullFeed.marketFF
    mff.ltpc.ltp = 570.4
    mff.ltpc.ltt = 1685790000000
    mff.ltpc.ltq = 100
    mff.ltpc.cp = 565.0
    
    # populate marketLevel
    for i in range(5):
        quote = mff.marketLevel.bidAskQuote.add()
        quote.bidQ = 1000 * (i + 1)
        quote.bidP = 570.0 - 0.05 * i
        quote.askQ = 500 * (i + 1)
        quote.askP = 570.4 + 0.05 * i
        
    mff.optionGreeks.delta = 1.0
    mff.optionGreeks.theta = 0.0
    mff.optionGreeks.gamma = 0.0
    mff.optionGreeks.vega = 0.0
    mff.optionGreeks.rho = 0.0
    
    # populate marketOHLC
    ohlc_1d = mff.marketOHLC.ohlc.add()
    ohlc_1d.interval = "1d"
    ohlc_1d.open = 567.0
    ohlc_1d.high = 572.5
    ohlc_1d.low = 566.1
    ohlc_1d.close = 570.4
    ohlc_1d.vol = 15000000
    ohlc_1d.ts = 1685790000000
    
    ohlc_30m = mff.marketOHLC.ohlc.add()
    ohlc_30m.interval = "30m"
    ohlc_30m.open = 569.0
    ohlc_30m.high = 571.0
    ohlc_30m.low = 568.5
    ohlc_30m.close = 570.4
    ohlc_30m.vol = 1200000
    ohlc_30m.ts = 1685790000000
    
    mff.atp = 569.8
    mff.vtt = 15000000
    mff.oi = 0.0
    mff.iv = 0.0
    mff.tbq = 4500000
    mff.tsq = 3200000
    
    with open(os.path.join(fixtures_dir, "full.bin"), "wb") as f:
        f.write(feed_response_full.SerializeToString())
    print("Created full.bin")

if __name__ == "__main__":
    main()
