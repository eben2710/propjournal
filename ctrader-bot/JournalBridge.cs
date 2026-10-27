// JournalBridge cBot for cTrader (Automate)
// Streams closed trades from the cTrader account to the PropJournal bridge.
//
// Install: cTrader Desktop -> Automate tab -> New cBot -> replace all code with
// this file -> Build -> add an instance on any chart of the account you journal
// (allow FullAccess when prompted) -> press Play. Keep it running while you trade.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net.Http;
using System.Text;
using cAlgo.API;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.FullAccess)]
    public class JournalBridge : Robot
    {
        [Parameter("Bridge URL", DefaultValue = "http://127.0.0.1:8787/api/trades", Group = "Bridge")]
        public string BridgeUrl { get; set; }

        [Parameter("Poll Seconds", DefaultValue = 5, MinValue = 2, Group = "Bridge")]
        public int PollSeconds { get; set; }

        [Parameter("Send Full History On Start", DefaultValue = true, Group = "Bridge")]
        public bool SendFullHistoryOnStart { get; set; }

        [Parameter("Notes Tag", DefaultValue = "cTrader", Group = "Bridge")]
        public string NotesTag { get; set; }

        private readonly HashSet<string> _seen = new HashSet<string>();
        private readonly HttpClient _http = new HttpClient();
        private int _total;

        protected override void OnStart()
        {
            _http.Timeout = TimeSpan.FromSeconds(5);
            if (SendFullHistoryOnStart)
            {
                var all = new List<string>();
                foreach (HistoricalTrade t in History)
                {
                    _seen.Add(Key(t));
                    all.Add(ToJson(t));
                }
                Send(all);
            }
            else
            {
                foreach (HistoricalTrade t in History)
                    _seen.Add(Key(t));
            }
            Timer.Start(Math.Max(2, PollSeconds));
            Print("JournalBridge started. Existing trades marked: {0}", _seen.Count);
        }

        protected override void OnTimer()
        {
            var pending = new List<string>();
            foreach (HistoricalTrade t in History)
            {
                var k = Key(t);
                if (_seen.Contains(k))
                    continue;
                _seen.Add(k);
                pending.Add(ToJson(t));
            }
            if (pending.Count > 0)
                Send(pending);
        }

        private static string Key(HistoricalTrade t)
        {
            return t.PositionId + "|" + t.ClosingTime.ToString("o", CultureInfo.InvariantCulture) + "|" +
                   t.ClosingPrice.ToString(CultureInfo.InvariantCulture);
        }

        private string ToJson(HistoricalTrade t)
        {
            double lots = t.VolumeInUnits;
            try
            {
                var sym = Symbols.GetSymbol(t.SymbolName);
                if (sym != null)
                    lots = sym.VolumeInUnitsToQuantity(t.VolumeInUnits);
            }
            catch (Exception)
            {
            }

            var sb = new StringBuilder();
            sb.Append("{");
            sb.Append("\"positionId\":").Append(t.PositionId).Append(",");
            sb.Append("\"closeTime\":\"").Append(t.ClosingTime.ToString("o", CultureInfo.InvariantCulture)).Append("\",");
            sb.Append("\"symbol\":\"").Append(Clean(t.SymbolName)).Append("\",");
            sb.Append("\"dir\":\"").Append(t.TradeType == TradeType.Buy ? "buy" : "sell").Append("\",");
            sb.Append("\"lots\":").Append(Math.Round(lots, 4).ToString(CultureInfo.InvariantCulture)).Append(",");
            sb.Append("\"entry\":").Append(t.EntryPrice.ToString("R", CultureInfo.InvariantCulture)).Append(",");
            sb.Append("\"exit\":").Append(t.ClosingPrice.ToString("R", CultureInfo.InvariantCulture)).Append(",");
            sb.Append("\"pnl\":").Append(Math.Round(t.NetProfit, 2).ToString(CultureInfo.InvariantCulture)).Append(",");
            sb.Append("\"label\":\"").Append(Clean(t.Label)).Append("\",");
            sb.Append("\"comment\":\"").Append(Clean(t.Comment)).Append("\",");
            sb.Append("\"tag\":\"").Append(Clean(NotesTag)).Append("\"");
            sb.Append("}");
            return sb.ToString();
        }

        private static string Clean(string s)
        {
            return (s ?? string.Empty).Replace("\\", " ").Replace("\"", "'");
        }

        private async void Send(List<string> items)
        {
            try
            {
                var payload = "[" + string.Join(",", items) + "]";
                using (var content = new StringContent(payload, Encoding.UTF8, "application/json"))
                using (var resp = await _http.PostAsync(BridgeUrl, content))
                {
                    if (resp.IsSuccessStatusCode)
                    {
                        _total += items.Count;
                        Print("Sent {0} trade(s) to journal (total {1})", items.Count, _total);
                    }
                    else
                        Print("Bridge returned {0}", resp.StatusCode);
                }
            }
            catch (Exception ex)
            {
                Print("Bridge unreachable ({0}). Is ctrader_bridge.py running?", ex.Message);
            }
        }

        protected override void OnStop()
        {
            Timer.Stop();
            Print("JournalBridge stopped.");
        }
    }
}
