import { COMPANY, SUPPORT } from './config';

const contact = SUPPORT.email || '[support email]';

// Plain text on purpose: edit the wording here and both pages update.
// Have a Rwandan lawyer review these pages before launch.

export const TERMS = {
  title: 'Terms of Service',
  intro: `These terms explain how you may use the ${COMPANY.name} website and app. By requesting a ride you agree to them.`,
  sections: [
    {
      heading: 'About the service',
      body: [
        `${COMPANY.name} is operated by ${COMPANY.legalName}, ${COMPANY.address}. It lets you choose a pickup and destination in Rwanda, see an estimated fare and send a moto ride request.`,
      ],
    },
    {
      heading: 'Using the app',
      body: [
        'You must give a correct name and a working Rwandan phone number so we or a rider can reach you.',
        'You must not send false or repeated requests, or use the service to harass anyone or break the law. We may limit or block numbers that do.',
      ],
    },
    {
      heading: 'Ride requests and fares',
      body: [
        'The fare shown is an estimate based on the road distance of the route, the base fare, the distance rates and the minimum fare shown in the Fare section. The estimate is valid for 10 minutes.',
        'Sending a request does not guarantee that a rider will be available. The app tells you when no rider has been contacted yet.',
        'The real route or a change of destination can change the final price. Please agree any difference before the ride starts.',
      ],
    },
    {
      heading: 'Payment',
      body: [
        'Pay for your ride as agreed for your trip. If you are unsure how payment works, ask our support team before you ride.',
      ],
    },
    {
      heading: 'Riders',
      body: [
        'Rides are accepted by riders whose details UBAmoto has checked. When a rider accepts your request, the app shows you the rider\'s name, phone number and plate number so you can call them and recognise them.',
        'Check that the rider and plate match what the app shows before you start. If they do not, do not ride and contact support.',
      ],
    },
    {
      heading: 'Safety',
      body: [
        'Wear a helmet, follow traffic rules and check the rider and trip details before you start. Do not carry illegal or dangerous items.',
        'In an emergency call 112 (Rwanda emergency number).',
      ],
    },
    {
      heading: 'Changes and cancellations',
      body: [
        'You can cancel a request in My Rides while it is waiting for a rider, or after a rider has accepted but before the ride has started. Once the ride has started, contact support.',
        'Please cancel as early as you can so riders are not kept waiting. We may limit requests from numbers that are often cancelled or not answered.',
      ],
    },
    {
      heading: 'Our responsibility',
      body: [
        'We work to keep the app available and accurate, but we cannot promise it is always error free or uninterrupted. Maps, routes and estimates come from third-party services and can be wrong.',
        'To the extent the law allows, we are not responsible for losses that come from things outside our control, such as network failures, road conditions or the actions of other road users.',
      ],
    },
    {
      heading: 'Changes to these terms',
      body: [
        'We may update these terms. When we make an important change we will ask you to accept the new version before your next request.',
      ],
    },
    {
      heading: 'Governing law and contact',
      body: [
        'These terms are governed by the laws of Rwanda.',
        `Questions? Contact us at ${contact}.`,
      ],
    },
  ],
};

export const PRIVACY = {
  title: 'Privacy Policy',
  intro: `${COMPANY.legalName} ("we") respects your privacy. This page explains what information the ${COMPANY.name} app collects, why, and your choices. We aim to follow Rwanda's law on the protection of personal data and privacy.`,
  sections: [
    {
      heading: 'What we collect',
      body: [
        'When you send a ride request: your name, your phone number, the pickup point, the destination, the route distance and time, and the estimated fare.',
        'Your location: only when you tap "Use my current location". We use it to place your pickup pin. It is stored only if you send a ride request with that pickup.',
        'Search text: what you type in the destination box is sent to our map provider to find places.',
      ],
    },
    {
      heading: 'What stays on your device',
      body: [
        'Your saved name and phone, your list of past requests, a private access code for each request and your acceptance of these terms are stored on your own device. The access code lets only this device follow or cancel the request. You can erase everything any time from Profile, under "Clear data on this device".',
      ],
    },
    {
      heading: 'How we use it',
      body: [
        'To process your ride request and contact you about it, to prevent abuse and spam, to keep the service working and to improve it. We do not sell your personal information.',
      ],
    },
    {
      heading: 'Who receives it',
      body: [
        'Our hosting and database provider (Supabase) stores your requests.',
        'Our map provider (Mapbox) receives search text and coordinates so it can find places and calculate routes.',
        'Riders and staff who handle your request see your trip details. A rider sees your name and phone number only after accepting your request, and you see the rider\'s name, phone number and plate number once a rider is assigned.',
        'Nobody can open your ride with only your phone number: viewing or cancelling a ride needs the private code on your device, or your booking reference together with your phone number.',
        'We may share information with authorities when the law requires it.',
        'Some of these providers store data outside Rwanda.',
      ],
    },
    {
      heading: 'How long we keep it',
      body: [
        'We keep ride requests for [retention period, e.g. 12 months] and then delete or anonymise them, unless the law requires us to keep them longer.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        `You may ask to see, correct or delete your personal information, or object to how we use it. Write to ${contact} and tell us the phone number you used.`,
        "You may also complain to Rwanda's data protection authority, the National Cyber Security Authority (NCSA).",
      ],
    },
    {
      heading: 'Security and children',
      body: [
        'We use encrypted connections and limit who can see ride data. No system is perfectly secure, so please tell us at once if you think your information was misused.',
        'The app is not meant for children under 18 without a parent or guardian.',
      ],
    },
    {
      heading: 'Changes and contact',
      body: [
        'We may update this policy and will show the new date at the top of this page.',
        `Questions about privacy? Contact ${COMPANY.legalName} at ${contact}.`,
      ],
    },
  ],
};