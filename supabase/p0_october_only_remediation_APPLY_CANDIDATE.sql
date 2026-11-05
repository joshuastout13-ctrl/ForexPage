-- ================================================================================
-- P0 OCTOBER-ONLY COMMISSION REMEDIATION PLAN — FOR REVIEW ONLY
-- STATUS: UNEXECUTED APPLY CANDIDATE (AWAITING JOSH STOUT WRITTEN APPROVAL)
-- GO/BLOCKED DECISION: GO (CERTIFIED PREFLIGHT PASSED)
-- TARGET: Supabase julhldzkiqdeuuoqmvlo
-- SCOPE: Exact 312 premature October 2026 commission rows ($24,500.71)
--        and 28 unlocked Nov/Dec history rows across 14 recipients.
-- EXCLUDED: Zero August/September mutations, zero locked history modifications,
--           zero index/constraint creation, zero payouts.
-- ================================================================================
BEGIN;

-- 1. Create temporary table populated with the exact 312 premature October row IDs
CREATE TEMP TABLE target_oct_premature_ids (id uuid PRIMARY KEY);

-- Insert all 312 exact forensically audited UUIDs
INSERT INTO target_oct_premature_ids (id) VALUES
  ('0032fca0-9c48-4138-9372-e789d005a554'),
  ('0037dd32-3a2f-4a72-a5cd-382394d5eb0d'),
  ('00dc837e-b10c-4781-aff5-a7973da190e8'),
  ('01ea1441-a07e-4eb9-aa35-eaa4f2b5e0ca'),
  ('02a7c25c-fea1-4a09-9f9a-58ba92e427cc'),
  ('03252550-14e1-4ad0-b900-f06826370d2a'),
  ('03c1f788-1d59-4546-a6ca-23c508dd313c'),
  ('0440cf2b-727c-4380-996b-ca8a98acc6c9'),
  ('044897c1-38d2-4504-a168-415a53694642'),
  ('04a51ff8-ed81-44b7-95a2-f4d287408215'),
  ('07b48890-379f-48ca-9f82-5d9e02d46084'),
  ('07efcf9b-1cf1-4291-9cec-dd177585f01e'),
  ('09020b3b-752a-4852-baa9-a0088a2d9865'),
  ('0a668eea-2f2a-42eb-8620-88880f63bace'),
  ('0c01d11b-3dc9-4965-bd67-7f835e2bc124'),
  ('0c3f3535-d9f6-44e4-98a2-d4d073c70eb8'),
  ('0cfb6826-56b1-4de4-a98a-32941efc7230'),
  ('0f6a5c49-db6f-4c62-b8fe-465bf44bf4f4'),
  ('11c9c67d-4455-4a1d-a468-21e523ab7966'),
  ('128bfe06-e7e0-407b-ba91-2bc1efd7d33d'),
  ('130c40c5-c96c-4fe4-a03a-329b4cf240fb'),
  ('15336126-8891-40d5-b63a-50e8a470b839'),
  ('153fe56c-b1b5-4628-885b-7e8167e2c71c'),
  ('15e3ddee-17c6-40c3-b230-66a4cd2aa19f'),
  ('160c6d30-845f-4c58-ab8a-48b90be7e701'),
  ('17cc626c-fba4-40c6-b77b-0ac7969aa2f3'),
  ('181f1a00-0ab7-4f3c-be24-851c76fd80ae'),
  ('196dfb66-0d32-4fc8-91cd-bbbc1a5ebced'),
  ('19996cc1-3905-4602-a8df-ce5ab07cb8fb'),
  ('1a2cc09f-4c2c-4c6a-8e98-e0fb09d4ea5a'),
  ('1b764355-e924-43b9-9a70-849f14da296e'),
  ('1c6be673-7d4f-45f6-8097-0d617e23a899'),
  ('1cb9a3a5-e36e-4584-b9b4-d79674e3de22'),
  ('1ce2569f-6361-4980-9a3a-45d54ab80aab'),
  ('1cf16fc5-da29-448f-afdd-76fd3e786028'),
  ('1d6d937e-4386-476e-8ada-eff09d79bb9a'),
  ('1dd343a1-1309-40b5-af1b-f5a0f10180e8'),
  ('1dfce05d-4642-4a7c-883f-1d20113f12df'),
  ('1ec5038d-872b-415c-9e54-0811bcef1304'),
  ('2044d4e8-07d0-4572-8339-7c8997a110ef'),
  ('2096f9c2-e047-47a8-92d4-f446672d37d8'),
  ('224ea961-5c1b-4e28-b4dc-7a69090e02f2'),
  ('235066b8-48e6-4178-9cb2-1897b4a53b88'),
  ('239c9c26-9e69-4a8f-84ef-29bd5d51f728'),
  ('25494012-fa3d-449e-a451-69da7e44a5b0'),
  ('254ab325-6288-430b-9110-1bebfbe9bbc6'),
  ('25e8896c-3132-4de4-8eca-6b40fddf767e'),
  ('2694877c-9057-48a4-a227-43ca5a0fd3bd'),
  ('26e2e2f5-63f1-408f-839b-add5e0653b45'),
  ('27bbdd41-cf38-4905-93d5-e82b524cafe9'),
  ('2995e2a8-6a4f-4295-bbe3-4fba3c41d1d6'),
  ('2a073dc6-6991-4438-a1e1-73719c84e6e9'),
  ('2aaaaf01-799b-4eba-b4bc-f405f6e6e1c9'),
  ('2ab2a2ea-0db9-4ccc-ab41-6224b263857b'),
  ('2cba0469-0521-4edb-ac47-64d7c20e6ee9'),
  ('2cf72a3b-3430-4be0-969b-54e6198932da'),
  ('2d3f858f-047c-4015-9f3b-11c083dabf96'),
  ('2e80ecd5-d99d-49f8-97a1-81d6875f0bbf'),
  ('2ed2feaf-4da6-49fa-a135-1e181589c4e9'),
  ('2f5d025d-1a57-4645-99dd-763bca2607e4'),
  ('324369f8-2a10-4ee1-b642-46e12be493a2'),
  ('33fd285a-8fcb-4480-8f22-4f49eb2e4c12'),
  ('35e5cca4-30dd-4546-bd28-bbdb9304a325'),
  ('35fe904d-08c4-43bf-855b-15e9bfadedf9'),
  ('39089fce-00b1-4912-9af7-1bf984f4721e'),
  ('390c34fc-efc7-40aa-af98-2421e019af3e'),
  ('398c53aa-3789-4d17-b5dd-b84a7d1ba58d'),
  ('3a541b8a-515e-4565-b058-3d41ca9ad1d4'),
  ('3dde169b-8998-4993-96ae-b35a1cf15515'),
  ('3e2ac8fb-1167-4742-b6e4-9f92c0147411'),
  ('3e9cf9d2-dc5e-4986-9d76-130fb61f9c35'),
  ('3f6c4a00-5f34-4d2a-b54c-09a94db197dd'),
  ('40eddc5d-1068-42ae-b19c-d0dc85b6d1ca'),
  ('431bf3ec-db2b-4b8d-a521-8f0412a4206c'),
  ('434c057c-df0a-4d95-91f5-98024be36e39'),
  ('4631f4a2-0aea-451a-8f32-a348ef125a64'),
  ('46b9507d-d799-4d85-bdc6-c35f7b8ccac8'),
  ('47adb402-d683-4a1a-ae53-ee3e737e12c8'),
  ('482d39ad-f7f8-467b-b4fe-bd692d29ca15'),
  ('483c4448-c773-4237-85ce-986e4835680f'),
  ('49c0ada2-b179-45c3-b1d7-e2f9ee0d8684'),
  ('49e37abb-2c3a-4fdc-8c57-7600a413f43a'),
  ('4a5f95b3-ec9f-441e-89a3-b77a76c2ab84'),
  ('4a8a86eb-ebcf-4b7d-b0d4-eb1c09b2a2f6'),
  ('4b25980a-efd8-4f1a-928c-ca1758cca42b'),
  ('4df5902c-d993-4a3a-aa70-4c9831f97e9c'),
  ('4f1b3ed9-ef10-401f-9b8e-655d1472134c'),
  ('517744e2-5ac6-416c-aed8-b2f7ba3ee887'),
  ('527289d4-92e6-46cf-937f-0a56a9278274'),
  ('52925e08-2041-4c4e-aa7f-4d31889d4380'),
  ('5320a77a-4bc0-442b-8f3a-692c81c1b9a1'),
  ('548ec4e6-aa74-4fc1-a74a-e0a4370ba96f'),
  ('5675cb20-ed69-4a94-9b6e-ad3e8ff69d91'),
  ('57abf737-9635-4c5b-8fa7-13c9144845e7'),
  ('58e8b5b7-eeca-4091-9d6d-921383d1fc84'),
  ('5a326386-8e15-4bd9-b216-ff5607530b1c'),
  ('5a6517ad-c65f-4be2-9124-b325d9e2307d'),
  ('5a7399ee-c2cb-4432-a6b3-080eb2af3938'),
  ('5b4666fc-9fad-419a-951d-e5656dafcfed'),
  ('5c716980-1bf7-4d00-88b2-9e3dbc3500c2'),
  ('5cff5b5a-cc1a-41d5-9b3d-40045f1b9503'),
  ('5d0f3fdb-b403-4db3-8c8d-f9954ea931d4'),
  ('5e1bdf98-7c37-4534-9fed-71af8b553a87'),
  ('5e872012-87d4-4bc4-a494-2d0406181869'),
  ('5f92cfb5-f797-48bb-93b8-eb3743107014'),
  ('61e8023d-5546-46c5-b1ab-0711bc1de2bc'),
  ('61f230ee-8ce8-4a3b-ad5f-0cc771e6314e'),
  ('625570c6-5fe2-4dac-be5f-a5afe67667b1'),
  ('63fa206f-d57f-4a94-b37c-e7dc4be08ec7'),
  ('640d35d0-35e1-4870-af15-773383fb3c1c'),
  ('652f8f6c-5813-484f-a53e-78eb9af7184e'),
  ('653c70d1-5cc6-4df7-85e3-646d678f4747'),
  ('65b6b8c0-223f-45cb-bc04-a4708f7938a8'),
  ('6611b0c1-3667-4f6c-935a-e2690934e61a'),
  ('667d9026-6051-49cf-8851-6739aeaeab24'),
  ('6697f792-13f5-497c-b830-7eaa86918fa5'),
  ('66a60036-bd1e-48ab-82d6-814dbfc9b88a'),
  ('66aa14c8-cf8d-441f-9fa1-66dee9d30f3d'),
  ('66b49590-2be8-47a1-bb82-19c89c2994c1'),
  ('66c32dd0-5c2c-40b0-a5f9-9add0cb8061b'),
  ('67c7a17e-7057-4d3a-a5da-347ec8b1bbf7'),
  ('69520c9c-bf1f-4c22-a491-9c49d5be92c8'),
  ('69da26cd-5e48-4c94-a6de-97ff4db3ada9'),
  ('69e23d69-705a-46ef-b5f8-1ebcac50b030'),
  ('6b5f9033-72fc-4e8a-80c4-66b4bb4ad587'),
  ('6bad860e-e621-425b-8cc2-6cc7cd5911be'),
  ('6bd4bf13-762e-4ef7-96e1-0d75cd896f93'),
  ('6c57e1ca-4b52-4b28-9cf0-4bc43fb00bd2'),
  ('6c70e1e8-0aa8-4f7a-9362-03849553af56'),
  ('6cec8a88-10fc-492f-aaca-a1932d6d1b92'),
  ('6f15cc72-8990-439c-96dc-240f894e0cae'),
  ('6fb38bab-7f72-45e8-ba66-a83fd44e5f1e'),
  ('701f9b2a-b7f9-4075-93bd-b5ac5fe6a4c2'),
  ('705ac1ac-efe1-424f-a6a1-8916b7a99c9c'),
  ('711b5579-1264-47aa-94e1-e1de2fd72642'),
  ('718a7841-fb3e-484f-bd96-2e610ff963be'),
  ('7205832a-08e5-4fc6-9665-3e38002bfef6'),
  ('7248c242-89ca-4104-9526-0c319284a45b'),
  ('727ea1af-1b18-449a-ba87-f4523fda78b6'),
  ('72b937e7-de05-4ba2-92c4-46a077f959b4'),
  ('72e2a981-b9cb-4fde-949c-28c3317a5993'),
  ('7350af53-4b6b-42fc-ac6e-bb2f3020f3e6'),
  ('740eb8f4-a5f0-4f70-ac82-bf308f05ef47'),
  ('74ebb12d-09ac-4d19-a596-793740a6bd0c'),
  ('74f73d16-9dcd-4369-aba3-4fea17e95b0d'),
  ('75163c71-6ece-4f4d-a10a-5566473a1588'),
  ('75245bd7-ec76-4bd6-8fdb-42b8a5b96f76'),
  ('7616804e-7a30-4a29-8d9c-6b3112619635'),
  ('76bef3b4-ebd9-4f46-a361-37c2b2e39e44'),
  ('775b5963-9331-44c2-9d68-d979f7b239ae'),
  ('784cf10d-428f-420b-8dfb-5980886cd1e4'),
  ('7ba6ad8b-289b-4f5b-9ee3-8e54a84ca2d3'),
  ('7bcb3397-4ce2-43b2-ac65-69865dcd8898'),
  ('7be12326-b088-4c6a-b6d6-fa1b101c3c32'),
  ('7cd0fb3d-96cf-411f-8505-152ef38dcf44'),
  ('7cfe7187-4df0-499f-85ed-6434f0d57d0f'),
  ('7d1597b6-0362-4e7c-a90a-beba3e8545f3'),
  ('7db206a0-54f1-47d4-a573-92f760065538'),
  ('7db81af3-5917-4da1-b57c-61486b92b3c9'),
  ('7e366158-66e0-4f2b-b7e9-2c1288a2201f'),
  ('7f5ddaef-2eba-4d73-a65e-9c60634830db'),
  ('7f757324-0a5c-4788-b619-7a64ab59f327'),
  ('7fd1f73e-1de2-4745-8d1f-eb3e916a44ce'),
  ('7fe30f99-54b4-4129-8cd1-96737e0a9c06'),
  ('8002a758-04da-454b-860b-de8745ee0908'),
  ('804d1e06-8780-486f-b66f-621b583abad2'),
  ('804fb23f-f5fd-48fc-9e2d-74b18bad3411'),
  ('81439902-8a4f-4172-84ed-50ca2f07a73a'),
  ('81581ea4-064a-4f30-b0ac-7808fd86265c'),
  ('8243cfd7-4271-43c1-ba37-82958fae58cb'),
  ('83bf7c6b-1aab-4847-84ec-9f5556a6b4fc'),
  ('840cdcf6-46a0-47df-b340-710b66322fbe'),
  ('85ac7fa4-6c69-4fc5-9dce-153d33c83f43'),
  ('86d24b5b-6ce6-4198-a182-a8b7ffd92d61'),
  ('8864d006-c9f5-4662-817c-86c5b4fb88b4'),
  ('88d3fa09-8d8d-4199-b7e8-f5746d220904'),
  ('88df353e-ae28-4cb9-b964-fe2805d4103d'),
  ('896980b5-514a-4c9b-9e3a-91905be1b322'),
  ('8b135ec6-6ad8-4e0b-81dd-1289e071f5b3'),
  ('8d87d09a-a178-44b4-a835-2feba3f06f1b'),
  ('8deff305-53b2-44e3-9d58-b0ac913882a9'),
  ('8ef67d4a-acc8-44f7-929a-e810fbd3f737'),
  ('8f8bab80-e24c-4385-a5b8-fdef17078c6a'),
  ('8fec5789-cb4f-49ff-b671-28eea2fa46c9'),
  ('90312c99-52be-4f39-89b2-55a50f67332e'),
  ('90ff7916-7584-4a27-8796-610ab05b514a'),
  ('92281572-327f-4dcd-8331-eaf91bbf0849'),
  ('92ef15e2-a4ec-42d2-a401-66b303314a32'),
  ('932eecfa-7d65-4dd9-8643-3e433d095e6b'),
  ('936ba4a9-64dd-400c-9225-b54605cec60c'),
  ('93b30ccb-f0e9-4b0f-8379-810bf6736008'),
  ('944e77de-d09a-4a22-aeca-bc2eeead325f'),
  ('96472be9-2f92-45ad-9f14-08358fa672db'),
  ('96c255f3-d8c5-4fab-aa6d-e52c4d757e24'),
  ('96f5ccce-988b-4931-8319-5ca1b57061b7'),
  ('97d0b3f2-a7a9-4144-bb73-feda305f2694'),
  ('97f0351f-d919-4d6d-9db8-7c5067f176f3'),
  ('98a91743-fee9-48fe-9c97-c5b11b65667a'),
  ('98fc2b27-6793-4395-8a38-7593ac60cb66'),
  ('99c2ecd2-5c42-495a-85d7-4a0112244582'),
  ('9a76aeba-b698-4292-99ac-3d7494b03b17'),
  ('9a7d1cb4-cc08-4b14-a49a-43881e405f54'),
  ('9a8be98e-ceb1-430e-9af5-5e3d8ff59089'),
  ('9aafe6d9-6e7c-417b-b688-099e5dc65764'),
  ('9aef42c8-7dfa-4683-a64c-4f1428c55919'),
  ('9b63eb90-7f7b-49ea-8394-d78a5953aa43'),
  ('9b72b072-b5ae-412f-83cc-34703fc87d26'),
  ('9b80197b-aea9-4e2e-b983-f16695448b91'),
  ('9c6d7789-de5f-453d-a1c3-ed534c5fe27c'),
  ('9d335f36-7da2-4984-be20-e2520c7bc0bc'),
  ('9e382613-7635-4acc-9a0c-3997008e075a'),
  ('9fa7dc66-897a-48b8-b04e-900558c2d2ab'),
  ('9fe95d97-1cd2-4f82-a16d-69ccb7991c11'),
  ('a080c2d4-b33e-4a36-9c1c-9dac21c26916'),
  ('a09d4544-787e-4a52-9e28-d77b101f2f48'),
  ('a1d9a521-8812-495f-a738-711560a57b32'),
  ('a297c129-fc95-49ac-93fd-baba1a019315'),
  ('a31985a5-d701-4b21-b1a1-3b6cfda2bdf9'),
  ('a3879faf-515d-45fe-b32d-a5390d401632'),
  ('a3f40339-7488-45b4-b68c-c4d0cd5fd610'),
  ('a4242f1a-3596-4cf8-834f-d85a83a2909f'),
  ('a4419e61-7c3b-4d2d-b105-7c3d15f5eba7'),
  ('a56c8b78-e77d-434a-a989-af95339a8943'),
  ('a59f03de-3af1-42f6-8f50-61ea115422d8'),
  ('a5c8b026-f499-4908-b216-e32f20189333'),
  ('a6ba193d-3d5b-495a-9ae5-6a72e08eb07a'),
  ('a6bb8fea-9fff-4766-892b-971b14b1f664'),
  ('a6e13e96-504b-4d72-9ab7-467d81983c82'),
  ('a82a9335-13f5-4d68-9cb2-629557fe094c'),
  ('a8acbc7c-6866-474a-ba8c-e8e4b6af9f9b'),
  ('a8f12760-0122-4865-9f52-f14b6074764d'),
  ('a9738c8e-5f2c-42c3-90fd-43ea18c0aa72'),
  ('a99be291-aee4-46cf-a48a-38312fb71c8f'),
  ('a9d52d91-a0b7-4b85-8871-86a5edf7c3c5'),
  ('ae0712ea-5f9d-4585-ba83-3e56e98bd55b'),
  ('ae8449ed-8546-464f-8a4b-ce8bf8d71b3e'),
  ('b0c17943-8c31-438c-b56d-56169885e043'),
  ('b153f556-f300-4689-b4ff-4bcd1580bdf6'),
  ('b37983bb-f127-40c6-ace7-2c391ad2be5d'),
  ('b4267db0-2276-44f5-9435-a68309ccaf8a'),
  ('b65b49cc-6c98-4fa3-8bf6-05c409376daa'),
  ('b8ce383a-19c0-4239-b7fb-be8c31c80573'),
  ('b93aee75-3805-4c7f-9318-c00461cab6c3'),
  ('ba1aefdb-c0f3-44b3-9ee4-d658216792ac'),
  ('ba3eaf95-1ca4-4552-a0f3-8c816608db70'),
  ('bb8222f0-5136-44e1-84d3-811a0467e010'),
  ('bddd4641-7336-43b9-930e-6f1a09781ab1'),
  ('be284873-6586-4dbd-bb19-aa0642fab33f'),
  ('bffd14b7-5c27-49ab-83fe-0daa51ccbb3b'),
  ('c1566c82-bfaa-489e-8c91-86f2df47ae6b'),
  ('c15df562-b9a9-49b3-b57e-71a91190b0db'),
  ('c2de3eab-3611-453e-971f-11cc6ad1188b'),
  ('c3f0b820-9591-4d8a-a0e0-46bf38c03449'),
  ('c56ecda9-71c4-4e33-a540-6102bc26aa13'),
  ('c7d2f06d-054c-417e-be83-eb5fdf11cb7c'),
  ('c9046dfe-221c-4e66-9f88-1a78e80242be'),
  ('ca00600b-ac73-4a97-919a-926af2bef1d8'),
  ('ca3228b2-c3bc-425b-a57e-da2efba1bfb3'),
  ('ca5eb153-7464-4e8e-98ca-1358a789976b'),
  ('cba92559-4c8f-4a78-a5c6-b7389e42cba3'),
  ('cbb1500b-8b24-4135-93a4-75d473f95962'),
  ('cc242e38-d2fe-40bd-8de2-825b46507dff'),
  ('cc8a5e38-211f-4ce3-8f46-03c617d53ffc'),
  ('cdc36275-ee3a-4045-b2df-1d7cb5842a53'),
  ('cddb78ea-11bc-4643-9154-abc5c2e936de'),
  ('ce55aaee-4193-47d6-998c-04c70bab7ea6'),
  ('d1a4dd84-4ee8-46bf-b83e-10bce06cdf25'),
  ('d2553732-b7e2-436b-a609-148436a0e41d'),
  ('d27bba43-20a1-4cb3-8e7d-6aa3264cba2f'),
  ('d32a0e65-94eb-42ee-b12d-55119aab2bff'),
  ('d47be697-4f2f-4aa1-a05c-442c9307de09'),
  ('d5a95c5e-8413-4b6f-9a82-554ff3d107ac'),
  ('d7df82a7-565e-480e-ad6d-c16822d9f6f6'),
  ('d814a1c4-0057-420f-9840-0257c50a41c2'),
  ('d9c9c18e-619b-4686-91a5-f33c1474f27d'),
  ('dadef126-01e4-42a0-a38b-758d4c4cf45c'),
  ('dcd9b80d-2896-43ef-aa55-c6a5bb36ee3b'),
  ('e00fcb02-1892-4173-bc36-518a0d964622'),
  ('e0d71b9b-1a0a-45b7-b37d-8a0c27cb0f82'),
  ('e0dd889d-892e-468e-aedc-cc410be21c42'),
  ('e2016dd4-dc74-494e-9b6f-a73f1d271f3d'),
  ('e2d85520-c55b-4330-8492-73c2f2d7e7dc'),
  ('e34946b9-1274-4980-ad87-242cd5887e11'),
  ('e7abaf60-4166-452d-b7a8-404ea3dee0e7'),
  ('e8814947-0255-4ef5-9482-e3f858e632df'),
  ('eb28537f-307e-4bc5-a951-06d40f3b0a78'),
  ('ec2b6a28-f23c-43d5-a7ef-e765338b1260'),
  ('ecf577c7-6337-4b59-a023-e71ec611e5fe'),
  ('ed6ae761-9df3-4db2-a287-2db6fec2da23'),
  ('ee25b58c-ce5b-4842-8408-514f48b3da23'),
  ('eea69ece-7411-47ee-bec7-f6ae6a66b03d'),
  ('eeb0fbae-8197-4a35-aa5b-b09cc0440b6a'),
  ('f06dbbb4-6024-40c1-830c-6c2257d30835'),
  ('f189df01-40ce-4b2d-acd5-4cdd455b4802'),
  ('f18fe2c3-2ef5-4037-b64b-436167568a30'),
  ('f2218837-a1da-4c12-8a2b-6d5d1d9ab564'),
  ('f2a31f05-b72d-4519-99a4-a13b8643e468'),
  ('f30b76ac-cc86-4caa-a4fa-52b2a550e16c'),
  ('f3e292c7-fcf6-4efa-93f3-2e3b78b75950'),
  ('f43db5dc-f502-4332-8c38-fe356ae58c5f'),
  ('f61052f2-9e58-4318-a2ee-b62664d074b8'),
  ('f65cf0fe-7907-4247-8bb6-c062e9083b2b'),
  ('f84677e2-abaa-451a-846e-d47ef2207ae2'),
  ('f8f5b4b5-428c-431e-8836-83624e558a1b'),
  ('f960d7dd-c7ca-4889-8194-5fb111f13e30'),
  ('f97a7549-85e5-4d07-a9f3-3e1e702b5908'),
  ('fa7ede2f-6a2d-4155-b94b-337b0df43db9'),
  ('fa87f058-3fe0-414a-a359-a49c3b4e52a9'),
  ('fbafccd7-ebf0-4455-87d2-bf26bc3675a2'),
  ('fd8e73ba-655f-44ac-a2fa-f5558ad764c8'),
  ('fe392408-4144-4a41-ab17-d43840401951'),
  ('ff4b21fb-d271-4660-89ca-88f113f04a04');

-- 2. Precondition Verification: Abort immediately if count, sum, or status does not match
DO $$
DECLARE
  v_count int;
  v_sum numeric(14,2);
  v_active_count int;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(amount), 0), COUNT(*) FILTER (WHERE status = 'ACTIVE')
  INTO v_count, v_sum, v_active_count
  FROM commission_earnings
  WHERE id IN (SELECT id FROM target_oct_premature_ids);

  IF v_count <> 312 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected 312 rows, found %', v_count;
  END IF;

  IF v_sum <> 24500.71 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected sum $24,500.71, found %', v_sum;
  END IF;

  IF v_active_count <> 312 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected 312 ACTIVE rows, found %', v_active_count;
  END IF;
END $$;

-- 3. Insert Authoritative Audit Record into audit_runs (Using verified production schema)
INSERT INTO audit_runs (
  id, admin_id, year, month_number, report_json, created_at
) VALUES (
  'a010c739-0000-4000-8000-202611030002',
  'p0_october_only_commission_remediation',
  2026,
  10,
  jsonb_build_object(
    'run_type', 'p0_october_only_commission_remediation',
    'audit_scope', 'COMMISSIONS_OCT_2026_ONLY',
    'status', 'SUCCESS',
    'summary', 'Soft-superseded exact 312 premature October 2026 commission rows ($24,500.71). Recomputed 28 unlocked Nov/Dec history rows across 14 recipients. Strictly preserved Jacob Wamsley Nov deposit ($11,700). Zero August/September mutations. October remains unfinalized.'
  ),
  NOW()
);

-- 4. Soft-supersede exact 312 premature October rows (Never physically delete)
UPDATE commission_earnings
SET 
  status = 'SUPERSEDED',
  superseded_at = NOW(),
  superseded_by_audit_id = 'a010c739-0000-4000-8000-202611030002',
  audit_notes = 'Premature October 2026 commission soft-superseded by P0 audit. October 2026 remains unfinalized.'
WHERE id IN (SELECT id FROM target_oct_premature_ids)
  AND status = 'ACTIVE';

-- 5. CAS-Protected History Updates for Months 11 and 12 across the 14 Recipients
-- (Optimistic Concurrency Control: Verifies rounded opening & ending balances before update)

-- 1. Valdes Valdes (inv_df9fbf05)
UPDATE investor_monthly_history SET opening_balance = 1774860.61, ending_balance = 1774860.61, updated_at = NOW() WHERE id = 'fbdc82be-5273-4591-9855-1da347f5306c' AND ROUND(opening_balance::numeric, 2) = 1775089.57 AND ROUND(ending_balance::numeric, 2) = 1775089.57;
UPDATE investor_monthly_history SET opening_balance = 1774860.61, ending_balance = 1774860.61, updated_at = NOW() WHERE id = '7a1b8fa9-919b-465f-a866-c26007a9ec94' AND ROUND(opening_balance::numeric, 2) = 1775089.57 AND ROUND(ending_balance::numeric, 2) = 1775089.57;

-- 2. ted Boardwalk (inv_a79798ca)
UPDATE investor_monthly_history SET opening_balance = 0.00, ending_balance = 0.00, updated_at = NOW() WHERE id = '7e3594a3-8047-4af4-9174-f7b4ad47d3da' AND ROUND(opening_balance::numeric, 2) = 189.80 AND ROUND(ending_balance::numeric, 2) = 189.80;
UPDATE investor_monthly_history SET opening_balance = 0.00, ending_balance = 0.00, updated_at = NOW() WHERE id = '893c1f57-087b-4d22-b669-235bce479c20' AND ROUND(opening_balance::numeric, 2) = 189.80 AND ROUND(ending_balance::numeric, 2) = 189.80;

-- 3. Stone and Co Owners Account (inv_015f3774)
UPDATE investor_monthly_history SET opening_balance = 442494.56, ending_balance = 442494.56, updated_at = NOW() WHERE id = '08e15048-1e4b-4833-ac90-e056080f276d' AND ROUND(opening_balance::numeric, 2) = 452400.00 AND ROUND(ending_balance::numeric, 2) = 452400.00;
UPDATE investor_monthly_history SET opening_balance = 442494.56, ending_balance = 442494.56, updated_at = NOW() WHERE id = 'bd68d180-19af-413e-a084-b1526b1ea1b2' AND ROUND(opening_balance::numeric, 2) = 452400.00 AND ROUND(ending_balance::numeric, 2) = 452400.00;

-- 4. Ross Wamsley (inv_920b8af8)
UPDATE investor_monthly_history SET opening_balance = 1572804.12, ending_balance = 1572804.12, updated_at = NOW() WHERE id = 'b75a4c6d-8de8-4fe4-918f-cdc721b72f01' AND ROUND(opening_balance::numeric, 2) = 1582596.15 AND ROUND(ending_balance::numeric, 2) = 1582596.15;
UPDATE investor_monthly_history SET opening_balance = 1572804.12, ending_balance = 1572804.12, updated_at = NOW() WHERE id = 'b398ce26-9aff-4256-affb-352af1173f7b' AND ROUND(opening_balance::numeric, 2) = 1582596.15 AND ROUND(ending_balance::numeric, 2) = 1582596.15;

-- 5. Joshua Stout (stout001)
UPDATE investor_monthly_history SET opening_balance = 3333453.52, ending_balance = 3333453.52, updated_at = NOW() WHERE id = 'd68be651-eb0c-4d90-90c2-6068b39d53f7' AND ROUND(opening_balance::numeric, 2) = 3334826.91 AND ROUND(ending_balance::numeric, 2) = 3334826.91;
UPDATE investor_monthly_history SET opening_balance = 3333453.52, ending_balance = 3333453.52, updated_at = NOW() WHERE id = 'c0ef6d79-2ab1-4946-96cf-2df11df9656a' AND ROUND(opening_balance::numeric, 2) = 3334826.91 AND ROUND(ending_balance::numeric, 2) = 3334826.91;

-- 6. josh richards (inv_e1d4f2af)
UPDATE investor_monthly_history SET opening_balance = 149279.08, ending_balance = 149279.08, updated_at = NOW() WHERE id = 'ff99dbd6-6a58-4077-9c3c-af9b68789dcb' AND ROUND(opening_balance::numeric, 2) = 151365.07 AND ROUND(ending_balance::numeric, 2) = 151365.07;
UPDATE investor_monthly_history SET opening_balance = 149279.08, ending_balance = 149279.08, updated_at = NOW() WHERE id = '21535f3d-3400-42fd-9e57-516cd14edbce' AND ROUND(opening_balance::numeric, 2) = 151365.07 AND ROUND(ending_balance::numeric, 2) = 151365.07;

-- 7. David Townley (inv_4d52f6a4)
UPDATE investor_monthly_history SET opening_balance = 38223.16, ending_balance = 38223.16, updated_at = NOW() WHERE id = '5ddb88a4-aaa2-442a-8fc5-0dd2dca34472' AND ROUND(opening_balance::numeric, 2) = 38468.83 AND ROUND(ending_balance::numeric, 2) = 38468.83;
UPDATE investor_monthly_history SET opening_balance = 38223.16, ending_balance = 38223.16, updated_at = NOW() WHERE id = '017f3446-2796-4f2b-8129-5c2e10431954' AND ROUND(opening_balance::numeric, 2) = 38468.83 AND ROUND(ending_balance::numeric, 2) = 38468.83;

-- 8. Adam Richards (inv_d3ec0cf8)
UPDATE investor_monthly_history SET opening_balance = 94395.75, ending_balance = 94395.75, updated_at = NOW() WHERE id = '57bdb4da-f6e2-49e9-a645-8395aa50e0e6' AND ROUND(opening_balance::numeric, 2) = 94505.43 AND ROUND(ending_balance::numeric, 2) = 94505.43;
UPDATE investor_monthly_history SET opening_balance = 94395.75, ending_balance = 94395.75, updated_at = NOW() WHERE id = 'ee7c63eb-4d51-4f54-8eca-62f8afcf09b9' AND ROUND(opening_balance::numeric, 2) = 94505.43 AND ROUND(ending_balance::numeric, 2) = 94505.43;

-- 9. Val Taylor (inv_6a1b838a)
UPDATE investor_monthly_history SET opening_balance = 312058.84, ending_balance = 312058.84, updated_at = NOW() WHERE id = 'ee670fef-cd1d-4619-9568-89cd34d0b8e6' AND ROUND(opening_balance::numeric, 2) = 312091.91 AND ROUND(ending_balance::numeric, 2) = 312091.91;
UPDATE investor_monthly_history SET opening_balance = 312058.84, ending_balance = 312058.84, updated_at = NOW() WHERE id = 'd08aaadf-df38-44e0-ac80-02212e258608' AND ROUND(opening_balance::numeric, 2) = 312091.91 AND ROUND(ending_balance::numeric, 2) = 312091.91;

-- 10. Michael Beck (inv_d2ab6da4)
UPDATE investor_monthly_history SET opening_balance = 600667.10, ending_balance = 600667.10, updated_at = NOW() WHERE id = '2ddb27c6-04ea-4e41-8ae6-1d0c9a1583c3' AND ROUND(opening_balance::numeric, 2) = 600874.68 AND ROUND(ending_balance::numeric, 2) = 600874.68;
UPDATE investor_monthly_history SET opening_balance = 600667.10, ending_balance = 600667.10, updated_at = NOW() WHERE id = '1445af6e-c1d5-45a1-b369-ad2c850ae4bf' AND ROUND(opening_balance::numeric, 2) = 600874.68 AND ROUND(ending_balance::numeric, 2) = 600874.68;

-- 11. Jim Colby (inv_a7e429ce)
UPDATE investor_monthly_history SET opening_balance = 252061.46, ending_balance = 252061.46, updated_at = NOW() WHERE id = 'd18e6301-7831-437b-a8f6-8a4f76b53d9c' AND ROUND(opening_balance::numeric, 2) = 252079.11 AND ROUND(ending_balance::numeric, 2) = 252079.11;
UPDATE investor_monthly_history SET opening_balance = 252061.46, ending_balance = 252061.46, updated_at = NOW() WHERE id = '77d808f9-3216-4bb8-a6ae-8e8b91720a7e' AND ROUND(opening_balance::numeric, 2) = 252079.11 AND ROUND(ending_balance::numeric, 2) = 252079.11;

-- 12. Nelson Guyer (inv_141417dc)
UPDATE investor_monthly_history SET opening_balance = 76652.41, ending_balance = 76652.41, updated_at = NOW() WHERE id = 'a334683d-cf3e-42ac-b4f6-b9b8176df7d0' AND ROUND(opening_balance::numeric, 2) = 76659.50 AND ROUND(ending_balance::numeric, 2) = 76659.50;
UPDATE investor_monthly_history SET opening_balance = 76652.41, ending_balance = 76652.41, updated_at = NOW() WHERE id = 'b8a3c3ee-f003-4a8c-bb3d-53a48779de29' AND ROUND(opening_balance::numeric, 2) = 76659.50 AND ROUND(ending_balance::numeric, 2) = 76659.50;

-- 13. Jacob Wamsley (inv_d0f857c7) — STRICTLY PRESERVES $11,700.00 NOVEMBER CASHFLOW
UPDATE investor_monthly_history 
SET opening_balance = 83751.41, ending_balance = 95451.41, updated_at = NOW() 
WHERE id = '02e688cb-04f2-4fff-9c98-b6a9138a7fa5' 
  AND ROUND(opening_balance::numeric, 2) = 84022.23 
  AND ROUND(ending_balance::numeric, 2) = 95722.23 
  AND deposits = 11700.00; -- Guard assertion: aborts if cashflow was modified

UPDATE investor_monthly_history 
SET opening_balance = 95451.41, ending_balance = 95451.41, updated_at = NOW() 
WHERE id = 'eb864618-068e-461a-9254-b213463302db' 
  AND ROUND(opening_balance::numeric, 2) = 95722.23 
  AND ROUND(ending_balance::numeric, 2) = 95722.23;

-- 14. Bill and Mary Kimball (inv_57a1a49a)
UPDATE investor_monthly_history SET opening_balance = 1777836.41, ending_balance = 1777836.41, updated_at = NOW() WHERE id = '5960acb2-9358-472d-8c91-bd191f99dd71' AND ROUND(opening_balance::numeric, 2) = 1777869.95 AND ROUND(ending_balance::numeric, 2) = 1777869.95;
UPDATE investor_monthly_history SET opening_balance = 1777836.41, ending_balance = 1777836.41, updated_at = NOW() WHERE id = '80464b6d-637a-4021-b488-80bf422b66f0' AND ROUND(opening_balance::numeric, 2) = 1777869.95 AND ROUND(ending_balance::numeric, 2) = 1777869.95;

-- 6. Postcondition Verification: Ensure exactly 312 rows superseded and 28 history rows updated
DO $$
DECLARE
  v_superseded_count int;
  v_history_updated_count int;
BEGIN
  SELECT COUNT(*) INTO v_superseded_count
  FROM commission_earnings
  WHERE id IN (SELECT id FROM target_oct_premature_ids)
    AND status = 'SUPERSEDED';

  IF v_superseded_count <> 312 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: Expected 312 SUPERSEDED rows, found %', v_superseded_count;
  END IF;

  SELECT COUNT(*) INTO v_history_updated_count
  FROM investor_monthly_history
  WHERE id IN (
    'fbdc82be-5273-4591-9855-1da347f5306c', '7a1b8fa9-919b-465f-a866-c26007a9ec94',
    '7e3594a3-8047-4af4-9174-f7b4ad47d3da', '893c1f57-087b-4d22-b669-235bce479c20',
    '08e15048-1e4b-4833-ac90-e056080f276d', 'bd68d180-19af-413e-a084-b1526b1ea1b2',
    'b75a4c6d-8de8-4fe4-918f-cdc721b72f01', 'b398ce26-9aff-4256-affb-352af1173f7b',
    'd68be651-eb0c-4d90-90c2-6068b39d53f7', 'c0ef6d79-2ab1-4946-96cf-2df11df9656a',
    'ff99dbd6-6a58-4077-9c3c-af9b68789dcb', '21535f3d-3400-42fd-9e57-516cd14edbce',
    '5ddb88a4-aaa2-442a-8fc5-0dd2dca34472', '017f3446-2796-4f2b-8129-5c2e10431954',
    '57bdb4da-f6e2-49e9-a645-8395aa50e0e6', 'ee7c63eb-4d51-4f54-8eca-62f8afcf09b9',
    'ee670fef-cd1d-4619-9568-89cd34d0b8e6', 'd08aaadf-df38-44e0-ac80-02212e258608',
    '2ddb27c6-04ea-4e41-8ae6-1d0c9a1583c3', '1445af6e-c1d5-45a1-b369-ad2c850ae4bf',
    'd18e6301-7831-437b-a8f6-8a4f76b53d9c', '77d808f9-3216-4bb8-a6ae-8e8b91720a7e',
    'a334683d-cf3e-42ac-b4f6-b9b8176df7d0', 'b8a3c3ee-f003-4a8c-bb3d-53a48779de29',
    '02e688cb-04f2-4fff-9c98-b6a9138a7fa5', 'eb864618-068e-461a-9254-b213463302db',
    '5960acb2-9358-472d-8c91-bd191f99dd71', '80464b6d-637a-4021-b488-80bf422b66f0'
  )
  AND (
    (id = '02e688cb-04f2-4fff-9c98-b6a9138a7fa5' AND opening_balance = 83751.41 AND ending_balance = 95451.41)
    OR (id = 'eb864618-068e-461a-9254-b213463302db' AND opening_balance = 95451.41 AND ending_balance = 95451.41)
    OR (id IN ('fbdc82be-5273-4591-9855-1da347f5306c', '7a1b8fa9-919b-465f-a866-c26007a9ec94') AND opening_balance = 1774860.61)
    OR (id IN ('7e3594a3-8047-4af4-9174-f7b4ad47d3da', '893c1f57-087b-4d22-b669-235bce479c20') AND opening_balance = 0.00)
    OR (id IN ('08e15048-1e4b-4833-ac90-e056080f276d', 'bd68d180-19af-413e-a084-b1526b1ea1b2') AND opening_balance = 442494.56)
    OR (id IN ('b75a4c6d-8de8-4fe4-918f-cdc721b72f01', 'b398ce26-9aff-4256-affb-352af1173f7b') AND opening_balance = 1572804.12)
    OR (id IN ('d68be651-eb0c-4d90-90c2-6068b39d53f7', 'c0ef6d79-2ab1-4946-96cf-2df11df9656a') AND opening_balance = 3333453.52)
    OR (id IN ('ff99dbd6-6a58-4077-9c3c-af9b68789dcb', '21535f3d-3400-42fd-9e57-516cd14edbce') AND opening_balance = 149279.08)
    OR (id IN ('5ddb88a4-aaa2-442a-8fc5-0dd2dca34472', '017f3446-2796-4f2b-8129-5c2e10431954') AND opening_balance = 38223.16)
    OR (id IN ('57bdb4da-f6e2-49e9-a645-8395aa50e0e6', 'ee7c63eb-4d51-4f54-8eca-62f8afcf09b9') AND opening_balance = 94395.75)
    OR (id IN ('ee670fef-cd1d-4619-9568-89cd34d0b8e6', 'd08aaadf-df38-44e0-ac80-02212e258608') AND opening_balance = 312058.84)
    OR (id IN ('2ddb27c6-04ea-4e41-8ae6-1d0c9a1583c3', '1445af6e-c1d5-45a1-b369-ad2c850ae4bf') AND opening_balance = 600667.10)
    OR (id IN ('d18e6301-7831-437b-a8f6-8a4f76b53d9c', '77d808f9-3216-4bb8-a6ae-8e8b91720a7e') AND opening_balance = 252061.46)
    OR (id IN ('a334683d-cf3e-42ac-b4f6-b9b8176df7d0', 'b8a3c3ee-f003-4a8c-bb3d-53a48779de29') AND opening_balance = 76652.41)
    OR (id IN ('5960acb2-9358-472d-8c91-bd191f99dd71', '80464b6d-637a-4021-b488-80bf422b66f0') AND opening_balance = 1777836.41)
  );

  IF v_history_updated_count <> 28 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: Expected 28 updated history rows, found %', v_history_updated_count;
  END IF;

  RAISE NOTICE 'SUCCESS: October-only correction plan validated perfectly (312 October rows soft-superseded, 28 unlocked history rows matched, Jacob Wamsley cashflows intact). Zero August/September mutations.';
END $$;

-- Authoritative Execution Commit (Requires Josh's Explicit Written Approval):
COMMIT;
