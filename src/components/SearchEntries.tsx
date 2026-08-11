import { useState, useMemo } from 'react';
import { JournalEntry } from '../types';
import { format, isWithinInterval, parseISO } from 'date-fns';
import { Search as SearchIcon, Tag, Calendar as CalendarIcon, FileText } from 'lucide-react';
import { motion } from 'motion/react';

interface SearchEntriesProps {
  entries: { [key: string]: JournalEntry };
  onSelectEntry: (date: Date) => void;
}

export default function SearchEntries({ entries, onSelectEntry }: SearchEntriesProps) {
  const [keyword, setKeyword] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const allEntries = Object.values(entries).sort((a, b) => b.date.localeCompare(a.date));
  
  // Extract all unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    allEntries.forEach(e => {
      const entryTags = [...(e.tags || []), ...(e.analysis?.tags || [])]
        .map(t => typeof t === 'string' ? t.trim() : '')
        .filter(t => t.length > 0 && t.length <= 25);
      
      // Limit to max 10 tags per entry to prevent layout explosion from faulty AI runs
      entryTags.slice(0, 10).forEach(t => tags.add(t));
    });
    return Array.from(tags).sort();
  }, [allEntries]);

  const filteredEntries = useMemo(() => {
    return allEntries.filter(entry => {
      // Keyword match (title or content)
      if (keyword) {
        const text = `${entry.title || ''} ${entry.content}`.toLowerCase();
        if (!text.includes(keyword.toLowerCase())) return false;
      }
      
      // Tag match
      if (selectedTags.length > 0) {
        const entryTags = [...(entry.tags || []), ...(entry.analysis?.tags || [])];
        if (!selectedTags.some(t => entryTags.includes(t))) return false;
      }

      // Date match
      if (startDate || endDate) {
        const entryDate = parseISO(entry.date);
        const start = startDate ? parseISO(startDate) : new Date(0);
        const end = endDate ? parseISO(endDate) : new Date(8640000000000000); // far future
        
        if (!isWithinInterval(entryDate, { start, end })) return false;
      }

      return true;
    });
  }, [allEntries, keyword, selectedTags, startDate, endDate]);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 h-full overflow-y-auto scrollbar-hide py-4 px-2">
      <div className="flex items-center gap-3 text-white border-b border-white/10 pb-4">
        <SearchIcon size={24} className="text-neon-cyan neon-glow-blue" />
        <h2 className="text-2xl font-poiret tracking-widest uppercase">Archive Search</h2>
      </div>

      <div className="glass p-6 rounded-2xl space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-[10px] text-baby-blue/40 uppercase font-bold tracking-widest flex items-center gap-2">
              <FileText size={12} /> Keywords
            </label>
            <input 
              type="text" 
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="Search content or title..."
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-baby-blue focus:outline-none focus:border-neon-cyan transition-colors"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] text-baby-blue/40 uppercase font-bold tracking-widest flex items-center gap-2">
              <CalendarIcon size={12} /> Date Range
            </label>
            <div className="flex gap-2">
              <input 
                type="date" 
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-baby-blue focus:outline-none focus:border-neon-cyan transition-colors dark-date-picker"
              />
              <span className="text-baby-blue/40 py-3">-</span>
              <input 
                type="date" 
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-baby-blue focus:outline-none focus:border-neon-cyan transition-colors dark-date-picker"
              />
            </div>
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="space-y-3">
            <label className="text-[10px] text-baby-blue/40 uppercase font-bold tracking-widest flex items-center gap-2">
              <Tag size={12} /> Filter by Tags
            </label>
            <div className="flex flex-wrap gap-2">
              {allTags.map(tag => {
                const isActive = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold tracking-wider uppercase transition-all ${
                      isActive 
                        ? 'bg-neon-cyan text-black shadow-[0_0_10px_rgba(0,225,255,0.4)] border border-neon-cyan' 
                        : 'bg-white/5 text-baby-blue/60 border border-white/10 hover:border-white/30'
                    }`}
                  >
                    #{tag}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-xs font-bold tracking-widest uppercase text-neon-purple neon-glow-purple">
          {filteredEntries.length} {filteredEntries.length === 1 ? 'Entry' : 'Entries'} Found
        </h3>
        {filteredEntries.map(entry => (
          <motion.div 
            key={entry.date}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => onSelectEntry(parseISO(entry.date))}
            className="glass p-6 rounded-2xl cursor-pointer hover:border-neon-cyan/50 transition-colors group"
          >
            <div className="flex justify-between items-start mb-2">
              <h4 className="text-lg text-white font-medium group-hover:text-neon-cyan transition-colors">
                {entry.title || format(parseISO(entry.date), 'MMMM d, yyyy')}
              </h4>
              <span className="text-xs text-baby-blue/40">{entry.date}</span>
            </div>
            
            <p className="text-sm text-baby-blue/70 line-clamp-2 mb-3">
              {entry.content.replace(/<[^>]*>/g, '') || "No content"}
            </p>
            
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-2 max-w-[70%]">
                {(() => {
                  const rawTags = [...(entry.tags || []), ...(entry.analysis?.tags || [])];
                  const cleanedTags = Array.from(new Set(rawTags))
                    .map(t => typeof t === 'string' ? t.trim() : '')
                    .filter(t => t.length > 0 && t.length <= 25);
                  const displayedTags = cleanedTags.slice(0, 8);
                  const extraCount = cleanedTags.length - displayedTags.length;
                  return (
                    <>
                      {displayedTags.map((t, i) => (
                        <span key={i} className="text-[10px] text-neon-pink bg-neon-pink/10 px-2 py-0.5 rounded">#{t}</span>
                      ))}
                      {extraCount > 0 && (
                        <span className="text-[10px] text-baby-blue/40 bg-white/5 px-2 py-0.5 rounded">+{extraCount} more</span>
                      )}
                    </>
                  );
                })()}
              </div>
              {entry.mood && <span className="text-xs text-baby-blue/50 flex-shrink-0">Mood: {entry.mood}</span>}
            </div>
          </motion.div>
        ))}
        {filteredEntries.length === 0 && (
          <div className="text-center py-12 text-baby-blue/30 text-sm italic">
            No entries found matching your criteria.
          </div>
        )}
      </div>
    </div>
  );
}
