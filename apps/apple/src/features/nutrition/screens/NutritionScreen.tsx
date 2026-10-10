import { Grid, MetricTile, Section, FeatureRow, PlaceholderCard } from '../../../shared/ui';

export function NutritionScreen() {
  return (
    <>
      <PlaceholderCard
        eyebrow="DAILY NUTRITION"
        tone="nutrition"
        title="Fuel your day"
        description="Your food diary and daily targets will appear here."
        action="Log food"
      />
      <Grid columns={3}>
        <MetricTile label="Protein" value={null} tone="nutrition" />
        <MetricTile label="Carbs" value={null} tone="recovery" />
        <MetricTile label="Fat" value={null} tone="brand" />
      </Grid>
      <Section title="Food & nutrition">
        <FeatureRow title="Food diary" subtitle="Meals, snacks and daily totals" />
        <FeatureRow
          title="Food search & scanning"
          subtitle="Search foods, scan barcodes or add a photo"
        />
        <FeatureRow title="Recipes & saved meals" subtitle="Your favourite foods and recipes" />
        <FeatureRow title="Supplements" subtitle="Track your supplements and routine" />
      </Section>
      <Section title="Planning">
        <FeatureRow title="Meal plans" subtitle="Plan meals around your goals" />
        <FeatureRow title="Nutrition goals" subtitle="Energy, macros and training day targets" />
        <FeatureRow title="Shopping list" subtitle="Everything you need for your plan" />
      </Section>
    </>
  );
}
