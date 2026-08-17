import { useEffect, useState } from 'react';

import { getDashboardSnapshot } from '../../services/weeklyPlanService';
import ProductOnboardingModal from '../onboarding/ProductOnboardingModal';
import DashboardHistoryCalendarBase from './DashboardHistoryCalendarBase';
import DashboardUpcomingPlan from './DashboardUpcomingPlan';

export default function DashboardHistoryCalendar(props) {
  const [weekDays, setWeekDays] = useState([]);

  useEffect(() => {
    let cancelled = false;

    getDashboardSnapshot()
      .then((snapshot) => {
        if (!cancelled) {
          setWeekDays(snapshot?.weekDays ?? []);
        }
      })
      .catch((error) => {
        console.warn('Dashboard upcoming plan', error);
      });

    return () => {
      cancelled = true;
    };
  }, [props.completed, props.target]);

  return (
    <>
      <ProductOnboardingModal />
      <DashboardHistoryCalendarBase {...props} />
      <DashboardUpcomingPlan weekDays={weekDays} />
    </>
  );
}
