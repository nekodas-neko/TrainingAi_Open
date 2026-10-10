import { Section, FeatureRow, PlaceholderCard } from '../../../shared/ui';

export function WorkoutScreen() {
  return (
    <>
      <PlaceholderCard
        eyebrow="NEXT WORKOUT"
        title="Your training starts here"
        description="Choose a program, follow your session and record every set."
        action="Start workout"
      />
      <Section title="Strength training">
        <FeatureRow title="Your programs" subtitle="Plans, schedules and progression" />
        <FeatureRow title="Exercise library" subtitle="Exercises, alternatives and technique" />
        <FeatureRow title="Workout history" subtitle="Past sessions, sets and personal records" />
        <FeatureRow title="Strength progress" subtitle="Follow your lifts and training goals" />
      </Section>
      <Section title="Activities">
        <FeatureRow title="Running & cardio" subtitle="Track sessions and structured intervals" />
        <FeatureRow title="Fitness tests" subtitle="Benchmarks and fitness assessments" />
      </Section>
    </>
  );
}
