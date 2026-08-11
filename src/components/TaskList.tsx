import { useState } from 'react';
import { Task } from '../types';
import { Plus, Trash2, CheckCircle2, Circle, Clock } from 'lucide-react';

interface TaskListProps {
  date: string;
  tasks: Task[];
  onAdd: (task: Partial<Task>) => void;
  onUpdate: (taskId: string, updates: Partial<Task>) => void;
  onDelete: (taskId: string) => void;
}

export default function TaskList({ tasks, onAdd, onUpdate, onDelete }: TaskListProps) {
  const [newTaskText, setNewTaskText] = useState('');

  const handleAdd = () => {
    if (!newTaskText.trim()) return;
    onAdd({ text: newTaskText, done: false, importance: 'medium' });
    setNewTaskText('');
  };

  const getImportanceColorClass = (importance: string) => {
    switch (importance?.toLowerCase()) {
      case 'low':
        return 'text-neon-cyan';
      case 'medium':
      case 'med':
        return 'text-neon-purple';
      case 'high':
        return 'text-neon-pink';
      case 'urgent':
        return 'text-red-500';
      default:
        return 'text-neon-purple';
    }
  };

  const getImportanceLabel = (importance: string) => {
    switch (importance?.toLowerCase()) {
      case 'low':
        return 'LOW';
      case 'medium':
      case 'med':
        return 'MED';
      case 'high':
        return 'HIGH';
      case 'urgent':
        return 'URGENT';
      default:
        return 'MED';
    }
  };

  const cycleImportance = (current: string) => {
    const normalized = current?.toLowerCase();
    if (normalized === 'low') return 'medium';
    if (normalized === 'medium' || normalized === 'med') return 'high';
    if (normalized === 'high') return 'urgent';
    return 'low';
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xs uppercase tracking-[0.2em] text-neon-pink font-bold mb-4 opacity-80">Daily Actions</h3>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="What needs to be done?"
          className="flex-grow bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-neon-blue transition-colors placeholder:text-baby-blue/20"
        />
        <button 
          onClick={handleAdd}
          className="p-2 bg-neon-blue rounded-xl text-black hover:bg-neon-cyan transition-colors cursor-pointer"
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="space-y-2">
        {tasks.map((task) => (
          <div key={task.id} className="group flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-all">
            <button 
              onClick={() => onUpdate(task.id!, { done: !task.done })}
              className={`transition-colors cursor-pointer ${task.done ? 'text-neon-cyan' : 'text-baby-blue/30 hover:text-neon-blue'}`}
            >
              {task.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
            </button>

            <div className="flex-grow flex flex-col">
              <input
                type="text"
                value={task.text}
                onChange={(e) => onUpdate(task.id!, { text: e.target.value })}
                className={`bg-transparent border-none p-0 text-sm focus:ring-0 ${task.done ? 'line-through text-baby-blue/30' : 'text-baby-blue'}`}
              />
              <div className="flex items-center gap-4 mt-1">
                <div className="flex items-center gap-1 text-[10px] text-neon-cyan uppercase tracking-widest font-bold">
                  <Clock size={10} className="text-neon-cyan/70 shrink-0" />
                  <input 
                    type="time" 
                    value={task.time || ''} 
                    onChange={(e) => onUpdate(task.id!, { time: e.target.value })}
                    className="bg-transparent border-none p-0 text-[10px] focus:ring-0 w-16 text-neon-cyan uppercase tracking-widest font-bold cursor-pointer font-mono"
                  />
                </div>
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold">
                  <span className="text-baby-blue/40">Priority:</span>
                  <button
                    type="button"
                    onClick={() => onUpdate(task.id!, { importance: cycleImportance(task.importance || 'medium') })}
                    className={`bg-transparent border-none p-0 text-[10px] uppercase tracking-widest font-bold cursor-pointer transition-colors ${getImportanceColorClass(task.importance || 'medium')}`}
                  >
                    {getImportanceLabel(task.importance || 'medium')}
                  </button>
                </div>
              </div>
            </div>

            <button 
              onClick={() => onDelete(task.id!)}
              className="opacity-0 group-hover:opacity-100 p-2 text-baby-blue/20 hover:text-red-400 transition-all cursor-pointer"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        {tasks.length === 0 && (
          <p className="text-center py-8 text-baby-blue/20 text-sm italic">Clear day, clear mind.</p>
        )}
      </div>
    </div>
  );
}
