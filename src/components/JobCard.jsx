import React from "react";
import { QRCodeSVG } from "qrcode.react";

function CardSection({ section }) {
  const paragraph =
    section.key === "summary" || section.key === "companyIntroduction";

  return (
    <section className="job-card__section">
      <h3>{section.title}</h3>
      {paragraph ? (
        <p className="job-card__paragraph">{section.items[0]}</p>
      ) : (
        <ol className="job-card__list">
          {section.items.map((item, index) => (
            <li key={`${section.key}-${index}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{item}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function JobCard({ data, page, pageIndex }) {
  const company = data.company || "公司信息暂未公开";
  const role = data.role || "岗位名称待确认";
  const locations = data.locations.length ? data.locations : ["地点待确认"];
  const showCompanyLink =
    data.companyUrl &&
    data.companyUrlConfidence === "high";
  const densityClass =
    page.weight > 23
      ? " job-card--dense job-card--extra-dense"
      : page.weight > 14
        ? " job-card--dense"
        : "";

  return (
    <article className={`job-card${densityClass}`}>
      <header className="job-card__header">
        <div className="job-card__header-copy">
          <p className="job-card__company">{company}</p>
          <h2>{role}</h2>
          <p className="job-card__locations">{locations.join(" · ")}</p>
        </div>
        {showCompanyLink ? (
          <div className="job-card__link">
            <QRCodeSVG
              value={data.companyUrl}
              size={54}
              level="M"
              bgColor="#ffffff"
              fgColor="#171717"
              marginSize={0}
            />
            <span>了解公司</span>
          </div>
        ) : null}
      </header>

      <div className="job-card__body">
        {page.sections.length ? (
          page.sections.map((section) => (
            <CardSection key={`${pageIndex}-${section.key}`} section={section} />
          ))
        ) : (
          <div className="job-card__blank">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

    </article>
  );
}
