export default function FiscalWarning() {
  return (
    <div className="alert-warn">
      <strong>⚠️ Estimation, ce n'est pas une déclaration officielle.</strong> Vérifiez tous les montants sur{' '}
      <a
        href="https://www.autoentrepreneur.urssaf.fr/"
        target="_blank"
        rel="noreferrer"
        className="underline font-medium"
      >
        autoentrepreneur.urssaf.fr
      </a>{' '}
      avant de déclarer. Revendo vous aide à organiser vos données mais ne remplace pas un conseiller fiscal.
      Les <em>dépenses</em> NE sont PAS déduites du CA URSSAF (régime micro-entreprise).
    </div>
  );
}
