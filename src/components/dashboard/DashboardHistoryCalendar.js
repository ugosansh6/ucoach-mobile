import ProductOnboardingModal from '../onboarding/ProductOnboardingModal';
import DashboardHistoryCalendarBase from './DashboardHistoryCalendarBase';

export default function DashboardHistoryCalendar(props) {
  return (
    <>
      <ProductOnboardingModal />
      <DashboardHistoryCalendarBase {...props} />
    </>
  );
}
