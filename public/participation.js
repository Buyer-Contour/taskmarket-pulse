const views = {
  trends: ['Market trends', 'See activity, tasks and rewards over time.', '/share-trends.png'],
  participation: ['Who posts work?', 'See how much work comes from repeat requesters on Tempo and Base.', '/share-participation.png'],
  activity: ['Market activity', 'Find the busiest hours and the latest activity on both chains.', '/share-activity.png'],
};

export function shareView(value) {
  return Object.hasOwn(views, value) ? views[value] : null;
}

export function postingMix({tasks, posters, repeat, repeatTasks}) {
  const once = posters - repeat;
  return {once, repeat: repeatTasks, unclassified: tasks - once - repeatTasks};
}

export function postingCsv(rows) {
  return [
    'week_start_utc,partial,tasks,distinct_posters,repeat_posters,tasks_by_repeat_posters,tasks_by_one_time_posters,tasks_with_invalid_requester',
    ...rows.map(row => {
      const {once, unclassified} = postingMix(row);
      return [row.week, row.partial, row.tasks, row.posters, row.repeat, row.repeatTasks, once, unclassified].join(',');
    }),
  ].join('\n') + '\n';
}
